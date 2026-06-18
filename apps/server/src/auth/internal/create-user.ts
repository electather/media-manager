// Shared direct-insert user creation used by bootstrap, the dev seed, and the
// admin user-creation endpoint. It writes the `user` + `account` (+ optionally
// `user_roles`) rows directly via drizzle instead of calling
// `auth.api.signUpEmail()`. Booting better-auth for the create path would load
// the `jwt` plugin, which lazily generates a JWKS keypair and encrypts its
// private key with whatever `BETTER_AUTH_SECRET` happened to be in scope. That
// row then lives in the same DB the Worker reads from, so if the two secrets
// disagree the Worker fails at startup with "Failed to decrypt private key".
//
// The account row mirrors the shape better-auth itself writes from
// `sign-up/email`: `providerId = "credential"`, `accountId = userId`,
// `password = <hash>`. That is exactly what `sign-in/email` looks up at login
// time. `hashPassword` is imported from `better-auth/crypto` (which re-exports
// `@better-auth/utils/password`), giving us the same scrypt implementation the
// runtime sign-in path uses to verify, without loading the full
// `betterAuth({...})` instance and its plugins.

import { hashPassword } from "better-auth/crypto";
import { type Db, getDb } from "../../db/client";
import { account, user } from "../../db/schema/auth";
import { userRoles } from "../../db/schema/auth/roles";

// Re-export the scrypt hash so callers that must hash *before* opening a write
// transaction (see `insertCredentialUserWithHashTx`) use the same primitive the
// runtime sign-in path verifies against, without reaching into `better-auth/crypto`
// themselves.
export { hashPassword };

// Drizzle's transaction-callback client. Sharing the insert helper across the
// standalone creators below and `claimBootstrap` (which runs inside its own
// transaction) keeps the better-auth credential account shape in one place.
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CreateCredentialUserInput {
  email: string;
  password: string;
  name: string;
  /** When set, assign exactly this role to the new user. */
  roleId?: string;
  /** Defaults to `false`; bootstrap sets it `true` (operator proved server access). */
  emailVerified?: boolean;
}

/** Same as {@link CreateCredentialUserInput} but with an already-computed scrypt
 *  hash instead of a plaintext password. */
export interface InsertCredentialUserWithHashInput {
  email: string;
  passwordHash: string;
  name: string;
  /** When set, assign exactly this role to the new user. */
  roleId?: string;
  /** Defaults to `false`; bootstrap sets it `true` (operator proved server access). */
  emailVerified?: boolean;
}

/**
 * Canonical user-creation primitive: inserts a `user` + credential `account`
 * pair (and, when `roleId` is given, a single `user_roles` row) using the
 * supplied transaction client and an already-computed password hash. This is the
 * one place the row shape better-auth's `sign-up/email` writes is reproduced, so
 * a credential-schema change (e.g. a new required `account` column) is made here
 * once. `account.updated_at` has no SQL default (unlike `user.updated_at`), so we
 * pass it explicitly; `userRoles.assignedAt` is an epoch-ms number, not a Date.
 *
 * Takes a precomputed hash so a caller can run the ~100ms scrypt `hashPassword`
 * *before* opening the surrounding write transaction — holding SQLite's single
 * writer lock for the full hash duration on every call would queue concurrent
 * writers until `busy_timeout` (#852 L2). Callers with a plaintext password use
 * {@link insertCredentialUserTx}, which hashes then delegates here.
 */
export async function insertCredentialUserWithHashTx(
  tx: DbTransaction,
  input: InsertCredentialUserWithHashInput,
): Promise<{ userId: string }> {
  const { email, passwordHash, name, roleId, emailVerified = false } = input;
  const userId = crypto.randomUUID();
  const accountRowId = crypto.randomUUID();
  const now = new Date();

  await tx.insert(user).values({ id: userId, email, name, emailVerified });
  await tx.insert(account).values({
    id: accountRowId,
    accountId: userId,
    providerId: "credential",
    userId,
    password: passwordHash,
    updatedAt: now,
  });
  if (roleId) {
    await tx.insert(userRoles).values({ userId, roleId, assignedAt: now.getTime() });
  }
  return { userId };
}

/**
 * Hashes the plaintext password and inserts the credential rows in one call.
 * `createUser`, `createUserWithRole`, and `claimBootstrap` all funnel through
 * this — none open the write transaction before the cheap inserts, so hashing
 * inline is fine for them. The invite-accept path opens the transaction up front
 * and hashes separately via {@link insertCredentialUserWithHashTx}.
 */
export async function insertCredentialUserTx(
  tx: DbTransaction,
  input: CreateCredentialUserInput,
): Promise<{ userId: string }> {
  const { password, ...rest } = input;
  return insertCredentialUserWithHashTx(tx, {
    ...rest,
    passwordHash: await hashPassword(password),
  });
}

/**
 * Creates a `user` + `account` pair and assigns `roleId` in a single
 * transaction. This is a service-layer helper, so errors throw rather than
 * exiting the process. The transaction means a failed account or role insert
 * can't leave an orphaned user row behind.
 */
export async function createUserWithRole(input: {
  email: string;
  password: string;
  name: string;
  roleId: string;
}): Promise<{ userId: string }> {
  return getDb().transaction((tx) => insertCredentialUserTx(tx, input));
}

/**
 * Creates a `user` + `account` pair without assigning any role. Used by the
 * admin user-creation endpoint when no role is requested.
 */
export async function createUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string }> {
  return getDb().transaction((tx) => insertCredentialUserTx(tx, input));
}

// Direct-insert user creation for bootstrap, dev seed, and admin endpoint. Avoids
// `auth.api.signUpEmail()` — booting better-auth loads the `jwt` plugin which lazily
// generates a JWKS keypair encrypted with `BETTER_AUTH_SECRET`; mismatched secrets crash
// the Worker at startup with "Failed to decrypt private key".
// Account row mirrors the `sign-up/email` shape: `providerId="credential"`, `accountId=userId`,
// `password=<hash>` — exactly what `sign-in/email` looks up at login time.

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
 * Canonical insertion point for the `sign-up/email` credential row shape — schema changes
 * (e.g. new required `account` column) happen here once. `account.updatedAt` has no SQL
 * default (unlike `user.updatedAt`), so we pass it explicitly; `userRoles.assignedAt` is
 * epoch-ms. Takes a precomputed hash so callers can run the ~100ms scrypt before opening
 * the write transaction — holding SQLite's writer lock for the full hash duration queues
 * concurrent writers until `busy_timeout` (#852 L2).
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
 * Hashes then inserts. `createUser`, `createUserWithRole`, and `claimBootstrap` use this
 * because they don't open a transaction before the inserts, so hashing inline is safe.
 * The invite-accept path hashes first then uses {@link insertCredentialUserWithHashTx}.
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
 * Creates a `user` + `account` pair and assigns `roleId` in one transaction,
 * preventing orphaned user rows if the account or role insert fails.
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

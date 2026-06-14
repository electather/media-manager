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
import { getDb } from "../../db/client";
import { account, user } from "../../db/schema/auth";
import { userRoles } from "../../db/schema/auth/roles";

/**
 * Creates a `user` + `account` pair and assigns `roleId` in a single
 * transaction. This is a service-layer helper, so errors throw rather than
 * exiting the process.
 */
export async function createUserWithRole(input: {
  email: string;
  password: string;
  name: string;
  roleId: string;
}): Promise<{ userId: string }> {
  const { email, password, name, roleId } = input;
  const db = getDb();
  const userId = crypto.randomUUID();
  const accountRowId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // Single transaction so we can't leave an orphaned user row behind if the
  // account or role insert fails. `account.updated_at` has no SQL default
  // (unlike `user.updated_at`), so we pass it explicitly. `userRoles.assignedAt`
  // is an epoch-ms number, not a Date.
  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id: userId, email, name, emailVerified: false });
    await tx.insert(account).values({
      id: accountRowId,
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      updatedAt: now,
    });
    await tx.insert(userRoles).values({ userId, roleId, assignedAt: now.getTime() });
  });
  return { userId };
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
  const { email, password, name } = input;
  const db = getDb();
  const userId = crypto.randomUUID();
  const accountRowId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id: userId, email, name, emailVerified: false });
    await tx.insert(account).values({
      id: accountRowId,
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      updatedAt: now,
    });
  });
  return { userId };
}

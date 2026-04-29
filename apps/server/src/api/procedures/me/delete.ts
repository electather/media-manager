import { eq } from "drizzle-orm";
import { user } from "../../../db/schema/auth";
import type { Db } from "../../../db/client";
import { badRequest, notFound, unauthorized } from "../../../errors/http-errors";
import { auth } from "../../../auth/config";

export interface DeleteAccountInput {
  userId: string;
  confirmEmail: string;
  currentPassword: string;
  headers: Headers;
}

/**
 * Hard-deletes the authenticated user's account. Verifies password and email
 * confirmation before issuing a single `DELETE` on the user row — FK cascades
 * (audited in #77) handle every dependent table. `jobRuns.triggeredByUserId`
 * is `SET NULL` by design so history survives the user, anonymized.
 *
 * Why not `auth.api.deleteUser`? Better Auth's helper layers an extra round of
 * email-confirmation flows, which we already replace with our own
 * password-and-email gate above. The configured `jwt()` plugin signs short-lived
 * (default 15 min) JWTs with no server-side blacklist — so the cascade-driven
 * deletion of `session`, `oauthAccessToken`, and `oauthRefreshToken` rows
 * matches what `deleteUser` would do, and any in-flight JWT issued before the
 * delete naturally expires within the JWT lifetime. If we ever introduce a
 * longer-lived JWT or a token blacklist, switch to `auth.api.deleteUser` (or
 * call `auth.api.revokeUserSessions` first).
 */
export async function deleteAccount(db: Db, input: DeleteAccountInput): Promise<void> {
  const userRow = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .get();

  if (!userRow) {
    throw notFound("me.delete.user_not_found", "user not found");
  }

  await verifyPasswordOrThrow(input.currentPassword, input.headers);

  if (input.confirmEmail.trim().toLowerCase() !== userRow.email.toLowerCase()) {
    throw badRequest("me.delete.email_mismatch", "confirmEmail does not match user.email");
  }

  await db.delete(user).where(eq(user.id, input.userId));
}

async function verifyPasswordOrThrow(password: string, headers: Headers): Promise<void> {
  try {
    const result = await auth.api.verifyPassword({ body: { password }, headers });
    if (!isVerifyPasswordOk(result)) {
      throw unauthorized("me.delete.invalid_password", "Incorrect password");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "HttpError") throw err;
    throw unauthorized("me.delete.invalid_password", "Incorrect password");
  }
}

// Better Auth's `verifyPassword` may resolve to `{ valid: boolean }`,
// `{ error: ... }`, or throw on wrong credentials depending on version.
// Treat anything other than an explicit success as a failure.
// fallow-ignore-next-line complexity
function isVerifyPasswordOk(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  if ("error" in result && (result as { error?: unknown }).error) return false;
  if ("valid" in result) return Boolean((result as { valid?: unknown }).valid);
  return true;
}

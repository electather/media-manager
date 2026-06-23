import { eq } from "drizzle-orm";
import { user } from "../../../db/schema/auth";
import type { Db } from "../../../db/client";
import { badRequest, notFound, unauthorized } from "../../../diagnostics/http-errors";
import { auth } from "../../../auth";

export interface DeleteAccountInput {
  userId: string;
  confirmEmail: string;
  currentPassword: string;
  headers: Headers;
}

/**
 * Hard-deletes user account after password+email verification.
 * FK cascades (#77) handle dependents; `jobRuns.triggeredByUserId` SET NULL preserves history.
 * Avoids `auth.api.deleteUser` because we already gate via password+email; JWT deletion
 * via expiry (default 15min, no blacklist) + cascade deletion of session/tokens matches.
 * If longer-lived JWT or token blacklist introduced, switch to `auth.api.deleteUser` or call `revokeUserSessions` first.
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

// Better Auth's `verifyPassword` is typed as `Promise<{ status: boolean }>` and
// resolves to `{ status: true }` on success; wrong credentials throw an
// `APIError` (see better-auth/dist/api/routes/password.mjs:185-193). Require
// strict `=== true` so any runtime divergence from the type fails closed.
async function verifyPasswordOrThrow(password: string, headers: Headers): Promise<void> {
  let result: Awaited<ReturnType<typeof auth.api.verifyPassword>>;
  try {
    result = await auth.api.verifyPassword({ body: { password }, headers });
  } catch (err) {
    if (err instanceof Error && err.name === "HttpError") throw err;
    throw unauthorized("me.delete.invalid_password", "Incorrect password");
  }
  if (result.status !== true) {
    throw unauthorized("me.delete.invalid_password", "Incorrect password");
  }
}

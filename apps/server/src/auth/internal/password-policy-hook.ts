import { APIError } from "better-auth/api";
import { passwordSchema } from "@nama/shared/auth";

// Path of Better Auth's changePassword endpoint (dist/api/routes/update-user.mjs).
// Better Auth never runs `passwordSchema` on `newPassword`, so authClient.changePassword
// could set a policy-violating password even though every client surface validates first (#879).
const CHANGE_PASSWORD_PATH = "/change-password";

// Slice of the Better Auth request-middleware ctx we read. `path`/`body` are stable
// across versions; typing loosely avoids importing BA's internal endpoint-context types.
type RequestHookCtxLike = {
  path?: string;
  body?: { newPassword?: unknown } | null;
};

// Change-password requests carry a string `newPassword` that violates the shared policy.
// Isolated so the hook itself stays a single guard, keeping cyclomatic complexity low.
function isPolicyViolation(body: RequestHookCtxLike["body"]): boolean {
  const newPassword = body?.newPassword;
  return typeof newPassword === "string" && !passwordSchema.safeParse(newPassword).success;
}

/**
 * Rejects a changePassword request whose `newPassword` fails the shared policy, closing the
 * server-side bypass in #879. Throws Better Auth's `APIError` so the client sees the same
 * 400 shape as other auth validation failures. Only guards `/change-password`; all other
 * auth paths pass through untouched.
 */
export async function enforcePasswordPolicy(ctx: RequestHookCtxLike): Promise<void> {
  if (ctx.path === CHANGE_PASSWORD_PATH && isPolicyViolation(ctx.body)) {
    throw new APIError("BAD_REQUEST", {
      message: "Password must be 8–256 characters and contain at least one letter and one digit.",
    });
  }
}

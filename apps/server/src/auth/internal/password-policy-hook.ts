import { APIError } from "better-auth/api";
import { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@nama/shared/auth";

// Paths that accept a `newPassword` body field but don't run passwordSchema internally.
// changePassword: dist/api/routes/update-user.mjs (#879)
// resetPassword:  dist/api/routes/password.mjs (#957)
const PASSWORD_PATHS = new Set(["/change-password", "/reset-password"]);

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

// Re-validates newPassword on PASSWORD_PATHS; throws APIError(400) on policy violation (#879, #957).
// All other paths pass through. Extracted to allow direct unit-testing without the Better Auth stack.
export async function enforcePasswordPolicy(ctx: RequestHookCtxLike): Promise<void> {
  if (ctx.path != null && PASSWORD_PATHS.has(ctx.path) && isPolicyViolation(ctx.body)) {
    throw new APIError("BAD_REQUEST", {
      message: `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters and contain at least one letter and one digit.`,
    });
  }
}

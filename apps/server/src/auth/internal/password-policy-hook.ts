import { APIError } from "better-auth/api";
import { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@nama/shared/auth";

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

// Re-validates newPassword on /change-password; throws APIError(400) on policy violation (#879).
// All other paths pass through. Extracted to allow direct unit-testing without the Better Auth stack.
export async function enforcePasswordPolicy(ctx: RequestHookCtxLike): Promise<void> {
  if (ctx.path === CHANGE_PASSWORD_PATH && isPolicyViolation(ctx.body)) {
    throw new APIError("BAD_REQUEST", {
      message: `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters and contain at least one letter and one digit.`,
    });
  }
}

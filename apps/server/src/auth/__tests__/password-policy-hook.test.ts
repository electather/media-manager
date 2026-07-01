import { describe, expect, it } from "vite-plus/test";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nama/shared/auth";
import { enforcePasswordPolicy } from "../internal/password-policy-hook";

// WHY: Better Auth's changePassword and resetPassword endpoints never run `passwordSchema`, so a
// crafted request could set a policy-violating password (#879, #957). These tests pin the hook.
describe("password-policy hook", () => {
  const conforming = "a".repeat(PASSWORD_MIN_LENGTH - 1) + "1";

  // WHY: a compliant new password (>= min length, letter + digit) must reach Better Auth's
  // handler unchanged — the hook only rejects, never rewrites.
  it.each([["/change-password"], ["/reset-password"]])(
    "allows a conforming newPassword on %s",
    async (path) => {
      await expect(
        enforcePasswordPolicy({ path, body: { newPassword: conforming } }),
      ).resolves.toBeUndefined();
    },
  );

  // WHY: this is the bypass #879/#957 closes — a policy-violating password reaching these paths
  // directly must be rejected with a 400 APIError, not silently persisted.
  it.each([
    ["/change-password", "too short", "ab1"],
    ["/change-password", "missing digit", "abcdefghij"],
    ["/reset-password", "too short", "ab1"],
    ["/reset-password", "missing letter", "1234567890"],
    ["/reset-password", "too long", `${"a1".repeat(PASSWORD_MAX_LENGTH / 2)}a1`],
  ])("rejects a %s newPassword (%s) with an APIError", async (path, _reason, newPassword) => {
    await expect(enforcePasswordPolicy({ path, body: { newPassword } })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  // WHY: the before-hook runs on every auth request; it must only guard PASSWORD_PATHS so
  // unrelated endpoints (e.g. sign-in) are untouched even when their body lacks a valid password.
  it("ignores requests on other auth paths", async () => {
    await expect(
      enforcePasswordPolicy({ path: "/sign-in/email", body: { newPassword: "short" } }),
    ).resolves.toBeUndefined();
  });

  // WHY: a request with no string newPassword is left to Better Auth's own body-schema validation
  // (which requires the field) — the hook must not throw the wrong error.
  it("skips validation when newPassword is absent", async () => {
    await expect(
      enforcePasswordPolicy({ path: "/reset-password", body: {} }),
    ).resolves.toBeUndefined();
  });
});

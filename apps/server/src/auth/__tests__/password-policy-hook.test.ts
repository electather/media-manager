import { describe, expect, it } from "vite-plus/test";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nama/shared/auth";
import { enforcePasswordPolicy } from "../internal/password-policy-hook";

// WHY: Better Auth's changePassword endpoint never runs `passwordSchema`, so a crafted
// authClient.changePassword request could set a policy-violating password even though every
// client surface validates first (#879). These tests pin the server-side re-validation.
describe("changePassword password-policy hook", () => {
  const conforming = "a".repeat(PASSWORD_MIN_LENGTH - 1) + "1";

  // WHY: a compliant new password (>= min length, letter + digit) must reach Better Auth's
  // handler unchanged — the hook only rejects, never rewrites.
  it("allows a conforming newPassword on the change-password path", async () => {
    await expect(
      enforcePasswordPolicy({ path: "/change-password", body: { newPassword: conforming } }),
    ).resolves.toBeUndefined();
  });

  // WHY: this is the bypass #879 closes — a too-short or non-alphanumeric password reaching
  // /change-password directly must be rejected with a 400 APIError, not silently persisted.
  it.each([
    ["too short", "ab1"],
    ["missing digit", "abcdefghij"],
    ["missing letter", "1234567890"],
    ["too long", `${"a1".repeat(PASSWORD_MAX_LENGTH / 2)}a1`],
  ])("rejects a %s newPassword with an APIError", async (_reason, newPassword) => {
    await expect(
      enforcePasswordPolicy({ path: "/change-password", body: { newPassword } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // WHY: the before-hook runs on every auth request; it must only guard /change-password so
  // unrelated endpoints (e.g. sign-in) are untouched even when their body lacks a valid password.
  it("ignores requests on other auth paths", async () => {
    await expect(
      enforcePasswordPolicy({ path: "/sign-in/email", body: { newPassword: "short" } }),
    ).resolves.toBeUndefined();
  });

  // WHY: a request to /change-password with no string newPassword is left to Better Auth's own
  // body-schema validation (which requires the field) — the hook must not throw the wrong error.
  it("skips validation when newPassword is absent", async () => {
    await expect(
      enforcePasswordPolicy({ path: "/change-password", body: {} }),
    ).resolves.toBeUndefined();
  });
});

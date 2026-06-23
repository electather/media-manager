import { describe, expect, it } from "vite-plus/test";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordSchema } from "../password";

/**
 * Pins the bounds of the shared new-password policy (reused by bootstrap-claim and
 * admin-create schemas): lowering the floor or dropping the cap is a security change
 * and must break a test.
 */
describe("passwordSchema", () => {
  it("exposes the documented bounds", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(256);
  });

  it("rejects a password below the minimum", () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
  });

  it("accepts a password at the minimum", () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  it("accepts a password at the maximum", () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH)).success).toBe(true);
  });

  it("rejects a password above the maximum with a too_big issue", () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH + 1));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "too_big")).toBe(true);
    }
  });
});

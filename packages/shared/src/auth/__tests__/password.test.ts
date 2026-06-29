import { describe, expect, it } from "vite-plus/test";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordIssueReason,
  passwordSchema,
} from "../password";

/**
 * Pins the bounds of the shared new-password policy (reused by bootstrap-claim and
 * admin-create schemas): lowering the floor or dropping the cap is a security change
 * and must break a test.
 */
describe("passwordSchema", () => {
  it("exposes the documented bounds", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(256);
  });

  it("accepts an 8-char alphanumeric password", () => {
    expect(passwordSchema.safeParse("abcdefg1").success).toBe(true);
  });

  it("rejects a password below the minimum", () => {
    expect(passwordSchema.safeParse("abcdef1").success).toBe(false);
  });

  it("rejects an alphanumeric password missing a digit", () => {
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
  });

  it("rejects an alphanumeric password missing a letter", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });

  it("accepts a long password with symbols and spaces", () => {
    expect(passwordSchema.safeParse("Tr0ub4dour & the white horse!").success).toBe(true);
  });

  it("accepts a non-Latin (Farsi) password with letters and digits", () => {
    // The letter/digit rule is Unicode-aware (`\p{L}`/`\p{N}`), so a password in
    // Persian script with Persian digits ۰–۹ must satisfy it — the app ships a fa locale.
    expect(passwordSchema.safeParse("گذرواژه۱۲۳").success).toBe(true);
  });

  it("rejects a Farsi password with letters but no digit", () => {
    expect(passwordSchema.safeParse("گذرواژهخوب").success).toBe(false);
  });

  it("rejects a password above the maximum with a too_big issue", () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH + 1));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "too_big")).toBe(true);
    }
  });
});

// The shared reason helper is the single source every client surface maps to a
// message; length must win over composition so a short value never reports the
// alphanumeric rule, and a valid value must return null (no error shown).
describe("passwordIssueReason", () => {
  it("returns null for a valid password", () => {
    expect(passwordIssueReason("abcdefg1")).toBe(null);
  });

  it("reports too_long past the maximum", () => {
    expect(passwordIssueReason("a1".repeat(PASSWORD_MAX_LENGTH))).toBe("too_long");
  });

  it("reports too_short below the minimum, even without a digit", () => {
    expect(passwordIssueReason("abc")).toBe("too_short");
  });

  it("reports missing_alphanumeric only once length is satisfied", () => {
    expect(passwordIssueReason("abcdefgh")).toBe("missing_alphanumeric");
  });
});

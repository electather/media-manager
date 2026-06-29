import { describe, expect, it, vi } from "vite-plus/test";

// Paraglide stub: stable English strings keyed by message id so we can assert
// the validator dispatches the right key without booting the runtime.
vi.mock("@/paraglide/messages", () => ({
  m: {
    auth_email_required: () => "Email is required.",
    auth_email_invalid: () => "Enter a valid email address.",
    auth_password_required: () => "Password is required.",
    shared_password_error: ({ reason }: { reason: string }) =>
      reason === "too_long"
        ? "Password must be at most 256 characters."
        : reason === "missing_alphanumeric"
          ? "Password must contain at least one letter and one number."
          : "Password must be at least 8 characters.",
    auth_confirm_password_required: () => "Please confirm your password.",
    auth_passwords_do_not_match: () => "Passwords do not match.",
    auth_name_required: () => "Name is required.",
  },
}));

import {
  validateConfirmPassword,
  validateEmail,
  validateLoginPassword,
  validateName,
  validateNewPassword,
} from "../lib/validators";

describe("validateEmail", () => {
  it("rejects empty input", () => {
    expect(validateEmail("")).toBe("Email is required.");
  });

  it("rejects malformed addresses", () => {
    expect(validateEmail("not-an-email")).toBe("Enter a valid email address.");
  });

  it("accepts a well-formed address", () => {
    expect(validateEmail("user@example.com")).toBeUndefined();
  });
});

describe("validateLoginPassword", () => {
  it("rejects empty input", () => {
    expect(validateLoginPassword("")).toBe("Password is required.");
  });

  it("accepts any non-empty value (login is server-authoritative)", () => {
    expect(validateLoginPassword("x")).toBeUndefined();
  });
});

describe("validateNewPassword", () => {
  it("rejects empty input", () => {
    expect(validateNewPassword("")).toBe("Password is required.");
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(validateNewPassword("abc123")).toBe("Password must be at least 8 characters.");
  });

  it("accepts an 8-character alphanumeric password", () => {
    expect(validateNewPassword("abcdefg1")).toBeUndefined();
  });

  it("flags a password missing a letter or digit", () => {
    expect(validateNewPassword("abcdefgh")).toBe(
      "Password must contain at least one letter and one number.",
    );
  });

  it("rejects passwords longer than 256 characters with the too-long message", () => {
    expect(validateNewPassword("a1".repeat(129))).toBe("Password must be at most 256 characters.");
  });

  it("accepts a password at the 256-character maximum", () => {
    expect(validateNewPassword(`${"a".repeat(255)}1`)).toBeUndefined();
  });
});

describe("validateConfirmPassword", () => {
  // Regression for the original PR bug: the confirm field passed validation even
  // when it did not match the password, deferring the error to the server.
  it("flags a mismatch with the password field", () => {
    expect(validateConfirmPassword("abc12345", "different")).toBe("Passwords do not match.");
  });

  it("rejects empty confirm input", () => {
    expect(validateConfirmPassword("", "abc12345")).toBe("Please confirm your password.");
  });

  it("accepts a matching confirm value", () => {
    expect(validateConfirmPassword("abc12345", "abc12345")).toBeUndefined();
  });
});

describe("validateName", () => {
  it("rejects whitespace-only names", () => {
    expect(validateName("   ")).toBe("Name is required.");
  });

  it("accepts a normal name", () => {
    expect(validateName("Jane Smith")).toBeUndefined();
  });
});

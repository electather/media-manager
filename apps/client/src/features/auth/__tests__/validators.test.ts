import { describe, expect, it, vi } from "vite-plus/test";

// Paraglide stub: stable English strings keyed by message id so we can assert
// the validator dispatches the right key without booting the runtime.
vi.mock("@/paraglide/messages", () => ({
  m: {
    auth_email_required: () => "Email is required.",
    auth_email_invalid: () => "Enter a valid email address.",
    auth_password_required: () => "Password is required.",
    auth_password_too_short: () => "Password must be at least 8 characters.",
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
    expect(validateNewPassword("short1")).toBe("Password must be at least 8 characters.");
  });

  it("accepts passwords of 8 characters or more", () => {
    expect(validateNewPassword("longenough")).toBeUndefined();
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

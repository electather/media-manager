import { describe, expect, it } from "vite-plus/test";
import { NAME_MAX_LENGTH, createUserSchema, updateUserSchema } from "../schemas";

/**
 * Name fields must be trimmed before length validation so that
 * whitespace-only values (e.g. "   ") are rejected rather than accepted
 * as non-empty strings.
 */
describe("createUserSchema", () => {
  it("trims leading and trailing whitespace from name before validating", () => {
    const result = createUserSchema.safeParse({
      name: "  Alice  ",
      email: "alice@example.com",
      password: "a".repeat(12),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Alice");
    }
  });

  it("rejects a whitespace-only name after trimming", () => {
    const result = createUserSchema.safeParse({
      name: "   ",
      email: "alice@example.com",
      password: "a".repeat(12),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name that exceeds the maximum length", () => {
    const result = createUserSchema.safeParse({
      name: "a".repeat(NAME_MAX_LENGTH + 1),
      email: "alice@example.com",
      password: "a".repeat(12),
    });
    expect(result.success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  it("trims leading and trailing whitespace from name before validating", () => {
    const result = updateUserSchema.safeParse({ name: "  Bob  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Bob");
    }
  });

  it("rejects a whitespace-only name after trimming", () => {
    const result = updateUserSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts an update with no name field", () => {
    const result = updateUserSchema.safeParse({ email: "bob@example.com" });
    expect(result.success).toBe(true);
  });
});

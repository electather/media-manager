import { describe, expect, it } from "vite-plus/test";
import { NAME_MAX_LENGTH } from "../../users/schemas";
import { acceptInviteSchema } from "../schemas";

/**
 * The name field on acceptInviteSchema must enforce the shared NAME_MAX_LENGTH
 * upper bound so that invite acceptance is consistent with every other
 * account-creation path. Pinned here: a regression that drops the cap is a
 * validation change and must break this test.
 */
describe("acceptInviteSchema name field", () => {
  const base = {
    email: "user@example.com",
    password: "a".repeat(12),
  };

  it("accepts a name at the maximum length", () => {
    const result = acceptInviteSchema.safeParse({
      ...base,
      name: "a".repeat(NAME_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a name that exceeds the maximum length", () => {
    const result = acceptInviteSchema.safeParse({
      ...base,
      name: "a".repeat(NAME_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = acceptInviteSchema.safeParse({ ...base, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only name after trimming", () => {
    const result = acceptInviteSchema.safeParse({ ...base, name: "   " });
    expect(result.success).toBe(false);
  });
});

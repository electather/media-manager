import { describe, expect, it } from "vite-plus/test";
import { NAME_MAX_LENGTH } from "../../users/schemas";
import { bootstrapClaimSchema } from "../schemas";

/**
 * The name field on bootstrapClaimSchema must enforce the shared NAME_MAX_LENGTH
 * upper bound so that the initial owner claim is consistent with every other
 * account-creation path. Pinned here: a regression that drops the cap is a
 * validation change and must break this test.
 */
describe("bootstrapClaimSchema name field", () => {
  const base = {
    token: "A".repeat(43),
    email: "admin@example.com",
    password: "a".repeat(12),
  };

  it("accepts a name at the maximum length", () => {
    const result = bootstrapClaimSchema.safeParse({
      ...base,
      name: "a".repeat(NAME_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a name that exceeds the maximum length", () => {
    const result = bootstrapClaimSchema.safeParse({
      ...base,
      name: "a".repeat(NAME_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = bootstrapClaimSchema.safeParse({ ...base, name: "" });
    expect(result.success).toBe(false);
  });
});

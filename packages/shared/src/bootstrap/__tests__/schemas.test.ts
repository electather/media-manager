import { describe, expect, it } from "vite-plus/test";
import { NAME_MAX_LENGTH } from "../../users/schemas";
import { bootstrapClaimSchema } from "../schemas";

/**
 * bootstrapClaimSchema.name must enforce shared NAME_MAX_LENGTH so initial owner
 * claim matches other account-creation paths. Regression guard: validation change
 * that drops the cap must break this test.
 */
describe("bootstrapClaimSchema name field", () => {
  const base = {
    token: "A".repeat(43),
    email: "admin@example.com",
    password: "a".repeat(11) + "1",
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

  it("rejects a whitespace-only name after trimming", () => {
    const result = bootstrapClaimSchema.safeParse({ ...base, name: "   " });
    expect(result.success).toBe(false);
  });

  it("trims leading and trailing whitespace from name before validating", () => {
    const result = bootstrapClaimSchema.safeParse({ ...base, name: "  Admin  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Admin");
    }
  });
});

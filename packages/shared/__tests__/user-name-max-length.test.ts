import { describe, it, expect } from "vite-plus/test";
import { bootstrapClaimSchema } from "@nama/shared/bootstrap";
import { acceptInviteSchema } from "@nama/shared/invites";
import { createUserSchema, updateUserSchema } from "@nama/shared/users";

// The 100-character upper bound exists so an oversized name is rejected at the
// validation boundary, before it ever reaches the unbounded SQLite `text`
// column. These tests pin the exact boundary (100 passes, 101 fails) on every
// schema that writes `user.name`, so the constraint cannot silently regress on
// any of the four write paths.
const NAME_AT_LIMIT = "a".repeat(100);
const NAME_OVER_LIMIT = "a".repeat(101);

const baseCredentials = {
  email: "person@example.com",
  // 12-char password satisfies the shared passwordSchema lower bound.
  password: "Sup3rSecret!",
};

describe("user name 100-character upper bound", () => {
  it("bootstrapClaimSchema rejects a name longer than 100 characters", () => {
    const token = "a".repeat(43);
    expect(
      bootstrapClaimSchema.safeParse({
        token,
        ...baseCredentials,
        name: NAME_AT_LIMIT,
      }).success,
    ).toBe(true);
    expect(
      bootstrapClaimSchema.safeParse({
        token,
        ...baseCredentials,
        name: NAME_OVER_LIMIT,
      }).success,
    ).toBe(false);
  });

  it("acceptInviteSchema rejects a name longer than 100 characters", () => {
    expect(acceptInviteSchema.safeParse({ ...baseCredentials, name: NAME_AT_LIMIT }).success).toBe(
      true,
    );
    expect(
      acceptInviteSchema.safeParse({
        ...baseCredentials,
        name: NAME_OVER_LIMIT,
      }).success,
    ).toBe(false);
  });

  it("createUserSchema rejects a name longer than 100 characters", () => {
    expect(createUserSchema.safeParse({ ...baseCredentials, name: NAME_AT_LIMIT }).success).toBe(
      true,
    );
    expect(createUserSchema.safeParse({ ...baseCredentials, name: NAME_OVER_LIMIT }).success).toBe(
      false,
    );
  });

  it("updateUserSchema rejects a present name longer than 100 characters", () => {
    // The field is optional, so an absent name must still pass; a present name
    // must respect the same 1–100 bound.
    expect(updateUserSchema.safeParse({}).success).toBe(true);
    expect(updateUserSchema.safeParse({ name: NAME_AT_LIMIT }).success).toBe(true);
    expect(updateUserSchema.safeParse({ name: NAME_OVER_LIMIT }).success).toBe(false);
  });
});

import { describe, it, expect } from "vite-plus/test";
import { bootstrapClaimSchema } from "@nama/shared/bootstrap";
import { acceptInviteSchema } from "@nama/shared/invites";
import { NAME_MAX_LENGTH, createUserSchema, updateUserSchema } from "@nama/shared/users";

// Upper bound rejects oversized names at validation boundary before reaching SQLite.
// Tests pin exact boundary (NAME_MAX_LENGTH passes, +1 fails) on all write paths
// so regressions break. Using shared constant catches bound changes.
const NAME_AT_LIMIT = "a".repeat(NAME_MAX_LENGTH);
const NAME_OVER_LIMIT = "a".repeat(NAME_MAX_LENGTH + 1);

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

import { describe, it, expect } from "vite-plus/test";
import {
  DISPLAY_NAME_MAX_LENGTH,
  connectionCreateSchema,
  connectionDisplayNameSchema,
} from "@nama/shared/connections";

// The upper bound exists so an oversized display name is rejected at the
// validation boundary before it reaches the unbounded SQLite `text` column.
// These tests pin the exact boundary (DISPLAY_NAME_MAX_LENGTH passes, +1
// fails) on every schema that writes `connection.displayName`.
const NAME_AT_LIMIT = "a".repeat(DISPLAY_NAME_MAX_LENGTH);
const NAME_OVER_LIMIT = "a".repeat(DISPLAY_NAME_MAX_LENGTH + 1);

describe("connection displayName 100-character upper bound", () => {
  it("connectionCreateSchema rejects a displayName longer than 100 characters", () => {
    const base = { pluginId: "trakt", userConfig: {} };
    // An absent displayName must still pass.
    expect(connectionCreateSchema.safeParse(base).success).toBe(true);
    expect(
      connectionCreateSchema.safeParse({ ...base, displayName: NAME_AT_LIMIT }).success,
    ).toBe(true);
    expect(
      connectionCreateSchema.safeParse({ ...base, displayName: NAME_OVER_LIMIT }).success,
    ).toBe(false);
  });

  it("connectionDisplayNameSchema rejects a displayName longer than 100 characters", () => {
    expect(
      connectionDisplayNameSchema.safeParse({ displayName: NAME_AT_LIMIT }).success,
    ).toBe(true);
    expect(
      connectionDisplayNameSchema.safeParse({ displayName: NAME_OVER_LIMIT }).success,
    ).toBe(false);
  });

  it("connectionDisplayNameSchema rejects an empty displayName", () => {
    expect(connectionDisplayNameSchema.safeParse({ displayName: "" }).success).toBe(false);
  });
});

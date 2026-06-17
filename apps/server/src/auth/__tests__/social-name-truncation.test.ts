import { describe, expect, it, vi } from "vite-plus/test";
import { NAME_MAX_LENGTH } from "@nama/shared/users";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

vi.mock("../../db/client", () => ({
  getDb: () => ({}),
}));

import { auth } from "../internal/config";

// Minimal user shape that satisfies the Better Auth hook parameter type.
const now = new Date();
function makeUser(overrides: { name: string; id?: string; emailVerified?: boolean }) {
  return {
    id: "u1",
    email: "a@example.com",
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Social/OAuth providers supply the user's display name without length
// validation. These tests ensure the user.create.before database hook
// truncates over-long names before they reach the DB column.
describe("social sign-up name truncation hook", () => {
  const createHook = auth.options.databaseHooks?.user?.create?.before;

  // WHY: a name that fits within NAME_MAX_LENGTH must be stored as-is so
  // normal social sign-ups are unaffected by the guard.
  it("leaves names at or below NAME_MAX_LENGTH unchanged", async () => {
    const name = "a".repeat(NAME_MAX_LENGTH);
    const result = await createHook!(makeUser({ name }));
    expect(result?.data?.name).toBe(name);
  });

  // WHY: an OAuth provider (e.g. Google) can return a display name longer than
  // 100 characters. Without the hook the raw value is written to the unbounded
  // SQLite text column, bypassing the API-layer Zod guard. The hook must cap
  // the value to NAME_MAX_LENGTH so every write path is covered.
  it("truncates names longer than NAME_MAX_LENGTH to exactly NAME_MAX_LENGTH", async () => {
    const longName = "a".repeat(NAME_MAX_LENGTH + 50);
    const result = await createHook!(makeUser({ name: longName }));
    expect(result?.data?.name).toBe("a".repeat(NAME_MAX_LENGTH));
    expect(result?.data?.name?.length).toBe(NAME_MAX_LENGTH);
  });

  // WHY: other user fields must be forwarded unchanged so the create path does
  // not silently drop data (e.g. emailVerified from a trusted provider).
  it("preserves other user fields when truncating the name", async () => {
    const longName = "b".repeat(NAME_MAX_LENGTH + 1);
    const result = await createHook!(makeUser({ id: "u2", name: longName, emailVerified: true }));
    expect(result?.data?.id).toBe("u2");
    expect(result?.data?.email).toBe("a@example.com");
    expect(result?.data?.emailVerified).toBe(true);
  });
});

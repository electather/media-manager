import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

let db: Db;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { needsBootstrap, resetBootstrapLatchForTest } from "../internal/bootstrap";

async function insertUser(): Promise<void> {
  await db.insert(user).values({ id: "u1", name: "Someone", email: "s@example.com" });
}

beforeEach(async () => {
  db = await createInMemoryDb();
  // The user-exists latch is module-level state that survives between tests in
  // the same process; reset it so each test starts from a clean detection state.
  resetBootstrapLatchForTest();
});

afterAll(() => cleanupInMemoryDbs());

describe("needsBootstrap latch", () => {
  // `needsBootstrap` is called on every `GET /api/config/public`. The flag only transitions
  // true→false (never back), so once a user is seen we cache `false` and skip `SELECT id FROM user`.
  // These tests pin that contract — a refactor must not reintroduce per-request queries or cache `true`.
  it("returns true while no user exists", async () => {
    expect(await needsBootstrap()).toBe(true);
  });

  it("returns false once a user exists", async () => {
    await insertUser();
    expect(await needsBootstrap()).toBe(false);
  });

  it("stays false after the latch is set, even if the user row is later removed", async () => {
    await insertUser();
    // First call observes the user and latches `false`.
    expect(await needsBootstrap()).toBe(false);

    // Deleting every user does not reopen bootstrap: the flag never transitions
    // false→true, so the cached value short-circuits the now-empty-table query.
    await db.delete(user);
    expect(await needsBootstrap()).toBe(false);
  });

  it("re-detects an empty table after the reset hook clears the latch", async () => {
    await insertUser();
    expect(await needsBootstrap()).toBe(false);

    // Clearing the latch and the user row restores live detection — the next
    // call queries again and sees the empty table.
    await db.delete(user);
    resetBootstrapLatchForTest();
    expect(await needsBootstrap()).toBe(true);
  });
});

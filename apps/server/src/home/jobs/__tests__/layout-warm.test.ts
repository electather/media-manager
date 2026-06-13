import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { feedback } from "../../../db/schema/preferences/feedback";
import { userHistoryMirror } from "../../../db/schema/catalog";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let db: Db;
vi.mock("../../../db/client", () => ({ getDb: () => db }));

const { listActiveUsers } = await import("../../internal/active-users");

const NOW = 2_000_000_000_000;

async function seedUser(id: string) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

beforeAll(async () => {
  db = await createInMemoryDb();
  await seedUser("recent_feedback");
  await seedUser("recent_history");
  await seedUser("stale_feedback");
  await seedUser("stale_history");
  await seedUser("both");
  await db.insert(feedback).values([
    {
      id: "f1",
      userId: "recent_feedback",
      tmdbId: "1",
      mediaType: "movie",
      action: "like",
      rating: null,
      note: null,
      createdAt: NOW - 5 * 24 * 60 * 60 * 1000,
    },
    {
      id: "f2",
      userId: "stale_feedback",
      tmdbId: "1",
      mediaType: "movie",
      action: "like",
      rating: null,
      note: null,
      createdAt: NOW - 30 * 24 * 60 * 60 * 1000,
    },
    {
      id: "f3",
      userId: "both",
      tmdbId: "1",
      mediaType: "movie",
      action: "like",
      rating: null,
      note: null,
      createdAt: NOW - 1 * 24 * 60 * 60 * 1000,
    },
  ]);
  await db.insert(userHistoryMirror).values([
    {
      userId: "recent_history",
      events: [],
      pluginCursors: {},
      lastSyncedAt: NOW - 7 * 24 * 60 * 60 * 1000,
    },
    {
      userId: "stale_history",
      events: [],
      pluginCursors: {},
      lastSyncedAt: NOW - 30 * 24 * 60 * 60 * 1000,
    },
    {
      userId: "both",
      events: [],
      pluginCursors: {},
      lastSyncedAt: NOW - 60 * 24 * 60 * 60 * 1000,
    },
  ]);
});

afterAll(() => cleanupInMemoryDbs());

describe("listActiveUsers", () => {
  it("includes users with feedback inside the 14d window", async () => {
    const rows = await listActiveUsers(NOW);
    const ids = rows.map((r) => r.userId).sort();
    expect(ids).toContain("recent_feedback");
  });

  it("includes users with recent history mirror sync", async () => {
    const rows = await listActiveUsers(NOW);
    expect(rows.map((r) => r.userId)).toContain("recent_history");
  });

  it("excludes users with no recent activity", async () => {
    const rows = await listActiveUsers(NOW);
    const ids = rows.map((r) => r.userId);
    expect(ids).not.toContain("stale_feedback");
    expect(ids).not.toContain("stale_history");
  });

  it("dedupes users hit by both signals", async () => {
    const rows = await listActiveUsers(NOW);
    const ids = rows.map((r) => r.userId).filter((id) => id === "both");
    expect(ids).toHaveLength(1);
  });
});

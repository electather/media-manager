import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", async () => {
  const actual = await vi.importActual<typeof import("../../db/client")>("../../db/client");
  return { ...actual, getDb: () => testDb };
});

const {
  listActiveRows,
  listActiveRowsKeyset,
  getActiveRow,
  listAllActiveRows,
  upsertActiveRow,
  softRemoveRow,
  bulkInsertActiveRows,
  trySeedLock,
  clearSeedLock,
  hasUserSeeded,
  __resetActiveRowsForTests,
} = await import("../repo");

let testDb: Db;

const U1 = "u1";
const MOVIE_KEY = { tmdbId: "550", mediaType: "movie" as const };
const TV_KEY = { tmdbId: "1396", mediaType: "tv" as const };

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values({
    id: U1,
    name: U1,
    email: "u1@test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await __resetActiveRowsForTests(testDb);
});

// ─── Read operations ─────────────────────────────────────────────────────────

describe("listActiveRows", () => {
  it("returns empty array when no rows exist", async () => {
    expect(await listActiveRows(U1)).toEqual([]);
  });

  it("returns active rows sorted newest first by default", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 2000);
    await upsertActiveRow(U1, TV_KEY, "manual", now - 1000);
    const rows = await listActiveRows(U1);
    expect(rows[0]!.tmdbId).toBe(TV_KEY.tmdbId);
    expect(rows[1]!.tmdbId).toBe(MOVIE_KEY.tmdbId);
  });

  it("respects limit option", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 2000);
    await upsertActiveRow(U1, TV_KEY, "manual", now - 1000);
    const rows = await listActiveRows(U1, { limit: 1 });
    expect(rows).toHaveLength(1);
  });

  it("filters by mediaType", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now);
    await upsertActiveRow(U1, TV_KEY, "manual", now);
    const rows = await listActiveRows(U1, { filter: { mediaType: "movie" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mediaType).toBe("movie");
  });

  it("sort=recentAsc returns oldest first", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 2000);
    await upsertActiveRow(U1, TV_KEY, "manual", now - 1000);
    const rows = await listActiveRows(U1, { sort: "recentAsc" });
    expect(rows[0]!.tmdbId).toBe(MOVIE_KEY.tmdbId);
  });
});

// ─── Keyset pagination ────────────────────────────────────────────────────────

describe("listActiveRowsKeyset", () => {
  it("returns first page without cursor", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 2000);
    await upsertActiveRow(U1, TV_KEY, "manual", now - 1000);
    const rows = await listActiveRowsKeyset(U1, { limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.tmdbId).toBe(TV_KEY.tmdbId);
  });

  it("returns next page using keyset cursor", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 2000);
    await upsertActiveRow(U1, TV_KEY, "manual", now - 1000);

    const firstPage = await listActiveRowsKeyset(U1, { limit: 1 });
    expect(firstPage).toHaveLength(1);
    const last = firstPage[0]!;

    const secondPage = await listActiveRowsKeyset(U1, {
      limit: 10,
      cursor: { addedAt: last.addedAt, id: last.id },
    });
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]!.tmdbId).toBe(MOVIE_KEY.tmdbId);
  });

  it("cursor excludes the pivot row itself", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 2000);
    await upsertActiveRow(U1, TV_KEY, "manual", now - 1000);

    const first = await listActiveRowsKeyset(U1, { limit: 1 });
    const pivot = first[0]!;
    const next = await listActiveRowsKeyset(U1, {
      limit: 1,
      cursor: { addedAt: pivot.addedAt, id: pivot.id },
    });
    expect(next[0]!.id).not.toBe(pivot.id);
  });

  it("returns empty array when cursor is past the last row", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now);
    const rows = await listActiveRowsKeyset(U1, { limit: 1 });
    const pivot = rows[0]!;
    const next = await listActiveRowsKeyset(U1, {
      limit: 10,
      cursor: { addedAt: pivot.addedAt, id: pivot.id },
    });
    expect(next).toHaveLength(0);
  });
});

// ─── getActiveRow ─────────────────────────────────────────────────────────────

describe("getActiveRow", () => {
  it("returns null when row does not exist", async () => {
    expect(await getActiveRow(U1, MOVIE_KEY)).toBeNull();
  });

  it("returns the row when it exists", async () => {
    await upsertActiveRow(U1, MOVIE_KEY, "manual", Date.now());
    const row = await getActiveRow(U1, MOVIE_KEY);
    expect(row).not.toBeNull();
    expect(row!.tmdbId).toBe(MOVIE_KEY.tmdbId);
  });

  it("returns removed rows (tombstone visible to reader)", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now);
    await softRemoveRow(U1, MOVIE_KEY, now + 1);
    const row = await getActiveRow(U1, MOVIE_KEY);
    expect(row?.state).toBe("removed");
  });
});

// ─── Sort key plumbing ────────────────────────────────────────────────────────

describe("sort key plumbing — addedAt ordering", () => {
  it("upsertActiveRow records the supplied addedAt timestamp", async () => {
    const ts = 1_700_000_000_000;
    await upsertActiveRow(U1, MOVIE_KEY, "manual", ts);
    const row = await getActiveRow(U1, MOVIE_KEY);
    expect(row!.addedAt).toBe(ts);
  });

  it("reactivation bumps addedAt to the new timestamp", async () => {
    const first = 1_700_000_000_000;
    const second = 1_700_000_001_000;
    await upsertActiveRow(U1, MOVIE_KEY, "manual", first);
    await softRemoveRow(U1, MOVIE_KEY, first + 1);
    await upsertActiveRow(U1, MOVIE_KEY, "manual", second);
    const row = await getActiveRow(U1, MOVIE_KEY);
    expect(row!.addedAt).toBe(second);
  });

  it("listAllActiveRows returns newest first", async () => {
    const now = Date.now();
    await upsertActiveRow(U1, MOVIE_KEY, "manual", now - 5000);
    await upsertActiveRow(U1, TV_KEY, "manual", now);
    const rows = await listAllActiveRows(U1);
    expect(rows[0]!.tmdbId).toBe(TV_KEY.tmdbId);
  });
});

// ─── Offset path (bulk insert + list) ────────────────────────────────────────

describe("offset path via bulkInsertActiveRows", () => {
  it("inserts new keys and returns inserted count", async () => {
    const now = Date.now();
    const count = await bulkInsertActiveRows(U1, [MOVIE_KEY, TV_KEY], "plugin", true, now);
    expect(count).toBe(2);
    const rows = await listAllActiveRows(U1);
    expect(rows).toHaveLength(2);
  });

  it("ignores duplicate keys on conflict", async () => {
    const now = Date.now();
    await bulkInsertActiveRows(U1, [MOVIE_KEY], "plugin", true, now);
    const count2 = await bulkInsertActiveRows(U1, [MOVIE_KEY], "plugin", true, now + 1000);
    expect(count2).toBe(0);
    expect(await listAllActiveRows(U1)).toHaveLength(1);
  });

  it("returns zero for empty keys array", async () => {
    expect(await bulkInsertActiveRows(U1, [], "plugin", false, Date.now())).toBe(0);
  });
});

// ─── Seed lock ────────────────────────────────────────────────────────────────

describe("seed lock", () => {
  it("trySeedLock returns true on first claim", async () => {
    expect(await trySeedLock(U1, Date.now())).toBe(true);
  });

  it("trySeedLock returns false when already locked", async () => {
    const now = Date.now();
    await trySeedLock(U1, now);
    expect(await trySeedLock(U1, now + 1)).toBe(false);
  });

  it("hasUserSeeded returns false before lock and true after", async () => {
    expect(await hasUserSeeded(U1)).toBe(false);
    await trySeedLock(U1, Date.now());
    expect(await hasUserSeeded(U1)).toBe(true);
  });

  it("clearSeedLock allows re-seeding", async () => {
    const now = Date.now();
    await trySeedLock(U1, now);
    await clearSeedLock(U1);
    expect(await trySeedLock(U1, now + 1)).toBe(true);
  });
});

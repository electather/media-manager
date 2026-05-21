import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola, type ConsolaInstance } from "consola";
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
  return {
    ...actual,
    getDb: () => testDb,
  };
});

vi.mock("../../jobs/events", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

const { emit } = await import("../../jobs/events");
const {
  getItems,
  getCounts,
  addItem,
  removeItem,
  listAvailable,
  seedFromPlugins,
  syncFromPlugins,
} = await import("../service");
const repo = await import("../repo");
const { __resetAvailabilityCache } = await import("../availability-cache");

let testDb: Db;

const log: ConsolaInstance = consola.withTag("test");

function makeMediaService(
  overrides: Partial<{
    getWatchlistFeed: ReturnType<typeof vi.fn>;
    getStatusBatch: ReturnType<typeof vi.fn>;
    getMatchingServers: ReturnType<typeof vi.fn>;
    getMetadata: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    getWatchlistFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getStatusBatch: vi.fn().mockResolvedValue({}),
    getMatchingServers: vi.fn().mockResolvedValue([]),
    getMetadata: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeCatalog() {
  return {
    getMetadataBatch: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn().mockResolvedValue(null),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCtx(opts: { userId?: string } = {}) {
  return {
    userId: opts.userId ?? "u1",
    mediaService: makeMediaService() as unknown as Parameters<typeof getItems>[0]["mediaService"],
    catalog: makeCatalog() as unknown as Parameters<typeof getItems>[0]["catalog"],
    log,
  };
}

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values({
    id: "u1",
    name: "u1",
    email: "u1@test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await repo.__resetForTests(testDb);
  __resetAvailabilityCache();
  (emit as ReturnType<typeof vi.fn>).mockClear();
});

describe("watchlist/service", () => {
  it("getItems triggers seed on first call and skips it on the second", async () => {
    const ctx = makeCtx();
    (ctx.mediaService.getWatchlistFeed as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ ids: { tmdb: "100" }, type: "movie" }],
      partial: false,
    });

    const first = await getItems(ctx);
    expect(first.items.map((i) => i.tmdbId)).toContain("100");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.mediaService.getWatchlistFeed).toHaveBeenCalledTimes(1);

    const second = await getItems(ctx);
    expect(second.items.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.mediaService.getWatchlistFeed).toHaveBeenCalledTimes(1);
  });

  it("getItems skips the seed when rows exist even if hasSeeded() is false (§M.2)", async () => {
    // Pre-existing rows (e.g. inserted via MCP) without a seed marker must
    // NOT trigger a plugin fan-out — design §M.2 reads rows first.
    const ctx = makeCtx();
    await addItem({ tmdbId: "777", mediaType: "movie" }, "manual", ctx);
    expect(await repo.hasSeeded(ctx.userId)).toBe(false);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const feedSpy = ctx.mediaService.getWatchlistFeed as ReturnType<typeof vi.fn>;
    feedSpy.mockClear();
    const res = await getItems(ctx);
    expect(res.items.map((i) => i.tmdbId)).toContain("777");
    expect(feedSpy).not.toHaveBeenCalled();
  });

  it("seedFromPlugins returns partial=true on plugin throw and does not mark seeded", async () => {
    const ctx = makeCtx();
    (ctx.mediaService.getWatchlistFeed as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    const res = await seedFromPlugins(ctx);
    expect(res).toEqual({ added: 0, partial: true });
    expect(await repo.hasSeeded(ctx.userId)).toBe(false);
  });

  it("addItem on a fresh key inserts and emits itemAdded", async () => {
    const ctx = makeCtx();
    const result = await addItem({ tmdbId: "200", mediaType: "movie" }, "manual", ctx);
    expect(result.wasActive).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("addItem on an active key returns wasActive=true and emits no event", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "200", mediaType: "movie" }, "manual", ctx);
    (emit as ReturnType<typeof vi.fn>).mockClear();
    const result = await addItem({ tmdbId: "200", mediaType: "movie" }, "manual", ctx);
    expect(result.wasActive).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("addItem reactivates a removed row and emits itemAdded", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "201", mediaType: "movie" }, "manual", ctx);
    await removeItem({ tmdbId: "201", mediaType: "movie" }, ctx);
    (emit as ReturnType<typeof vi.fn>).mockClear();
    const result = await addItem({ tmdbId: "201", mediaType: "movie" }, "manual", ctx);
    expect(result.wasActive).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("removeItem is idempotent across active / already-removed / never-existed", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "300", mediaType: "movie" }, "manual", ctx);
    (emit as ReturnType<typeof vi.fn>).mockClear();

    const first = await removeItem({ tmdbId: "300", mediaType: "movie" }, ctx);
    expect(first.removed).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);

    const second = await removeItem({ tmdbId: "300", mediaType: "movie" }, ctx);
    expect(second.removed).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);

    const third = await removeItem({ tmdbId: "999", mediaType: "movie" }, ctx);
    expect(third.removed).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("removeItem then syncFromPlugins does not resurrect the removed row", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "400", mediaType: "movie" }, "manual", ctx);
    await removeItem({ tmdbId: "400", mediaType: "movie" }, ctx);

    (ctx.mediaService.getWatchlistFeed as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ ids: { tmdb: "400" }, type: "movie" }],
      partial: false,
    });

    await syncFromPlugins(ctx);
    const row = await repo.findByKey(ctx.userId, { tmdbId: "400", mediaType: "movie" });
    expect(row?.state).toBe("removed");
  });

  it("listAvailable pre-filters by getMatchingServers", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "500", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "501", mediaType: "movie" }, "manual", ctx);
    // The matching-servers cache was warmed by `addItem`'s single-item enrich
    // with the default `[]` mock value. Re-evaluate against the new mock by
    // dropping cached entries so the assertion exercises the pre-filter, not
    // a stale cache hit.
    __resetAvailabilityCache();
    (ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>).mockImplementation(
      async (tmdbId: string) => (tmdbId === "500" ? [{ id: "jellyfin", label: "Jellyfin" }] : []),
    );

    const res = await listAvailable(10, ctx);
    expect(res.items.map((i) => i.tmdbId)).toEqual(["500"]);
  });

  it("event emit error is swallowed so the row still commits", async () => {
    const ctx = makeCtx();
    (emit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no handler"));
    const result = await addItem({ tmdbId: "600", mediaType: "movie" }, "manual", ctx);
    expect(result.wasActive).toBe(false);
    const row = await repo.findByKey(ctx.userId, { tmdbId: "600", mediaType: "movie" });
    expect(row?.state).toBe("active");
  });
});

describe("watchlist/service v2 (pagination + counts + filter)", () => {
  it("getItems paginates with a keyset cursor and signals end-of-list with cursor=null", async () => {
    const ctx = makeCtx();
    // Seed 7 rows; ask for 3 per page.
    for (let i = 0; i < 7; i++) {
      await addItem({ tmdbId: `${700 + i}`, mediaType: "movie" }, "manual", ctx);
    }
    const page1 = await getItems(ctx, { limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.cursor).not.toBeNull();

    const page2 = await getItems(ctx, { limit: 3, cursor: page1.cursor! });
    expect(page2.items).toHaveLength(3);
    expect(page2.cursor).not.toBeNull();

    const page3 = await getItems(ctx, { limit: 3, cursor: page2.cursor! });
    expect(page3.items).toHaveLength(1);
    // Under-full page => no more rows; cursor null.
    expect(page3.cursor).toBeNull();

    const all = [...page1.items, ...page2.items, ...page3.items];
    expect(new Set(all.map((i) => i.tmdbId)).size).toBe(7);
  });

  it("getItems with filter=upcoming drops rows whose bucket does not match", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "800", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "801", mediaType: "movie" }, "manual", ctx);
    // Mark "801" as upcoming via canonical metadata (year > current).
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:801": {
        tmdbId: "801",
        mediaType: "movie",
        title: "Future Flick",
        year: new Date().getUTCFullYear() + 5,
        genres: [],
      },
    });
    const res = await getItems(ctx, { filter: "upcoming" });
    expect(res.items.map((i) => i.tmdbId)).toEqual(["801"]);
  });

  it("getItems with filter=ready does not run plugin probes when the watchlist is empty", async () => {
    const ctx = makeCtx();
    await repo.markSeeded(ctx.userId, Date.now()); // skip first-GET seed path
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const probeSpy = ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>;
    probeSpy.mockClear();
    const res = await getItems(ctx, { filter: "ready" });
    expect(res.items).toEqual([]);
    expect(res.cursor).toBeNull();
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it("getCounts returns aggregate buckets and total without artwork dispatch", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "900", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "901", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "902", mediaType: "movie" }, "manual", ctx);

    // 900 is on a library server (ready), 901 is upcoming, 902 stays unknown.
    // Reset the cache so the warmed `[]` value from `addItem` doesn't shadow
    // the per-tmdb mock below.
    __resetAvailabilityCache();
    (ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>).mockImplementation(
      async (tmdbId: string) => (tmdbId === "900" ? [{ id: "jellyfin", label: "Jellyfin" }] : []),
    );
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:901": {
        tmdbId: "901",
        mediaType: "movie",
        title: "Far Future",
        year: new Date().getUTCFullYear() + 3,
        genres: [],
      },
    });

    const counts = await getCounts(ctx);
    expect(counts.total).toBe(3);
    expect(counts.ready).toBe(1);
    expect(counts.upcoming).toBe(1);
    expect(counts.awaiting).toBe(0);
  });

  it("getCounts on an empty watchlist short-circuits without plugin work", async () => {
    const ctx = makeCtx();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const probeSpy = ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const statusSpy = ctx.mediaService.getStatusBatch as ReturnType<typeof vi.fn>;
    const counts = await getCounts(ctx);
    expect(counts).toEqual({ ready: 0, inProgress: 0, awaiting: 0, upcoming: 0, total: 0 });
    expect(probeSpy).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it("getItems with filter skips past empty windows server-side and surfaces only non-empty pages", async () => {
    const ctx = makeCtx();
    // Direct repo insert with explicit timestamps so addedAt ordering is
    // deterministic — addItem's wall-clock Date.now() collapses to the same
    // millisecond on a fast test run, and the ordering tiebreaker (id DESC)
    // is the random cuid. We need 950 to be the OLDEST so it lands past the
    // first empty window.
    await repo.bulkInsertIgnoreConflict(
      ctx.userId,
      [{ tmdbId: "950", mediaType: "movie" }],
      "manual",
      false,
      100,
    );
    await repo.bulkInsertIgnoreConflict(
      ctx.userId,
      [
        { tmdbId: "951", mediaType: "movie" },
        { tmdbId: "952", mediaType: "movie" },
        { tmdbId: "953", mediaType: "movie" },
        { tmdbId: "954", mediaType: "movie" },
      ],
      "manual",
      false,
      200,
    );
    __resetAvailabilityCache();
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:950": {
        tmdbId: "950",
        mediaType: "movie",
        title: "Far Future",
        year: new Date().getUTCFullYear() + 5,
        genres: [],
      },
    });

    // With limit=1 + 3x overshoot = fetchSize=3 per hop. First window (top 3 by
    // addedAt DESC: 951–954 minus one) is empty for `filter=upcoming`; the
    // handler advances the cursor and the second hop picks up 950.
    const res = await getItems(ctx, { limit: 1, filter: "upcoming" });
    expect(res.items.map((i) => i.tmdbId)).toEqual(["950"]);
  });

  it("getItems with filter anchors cursor at the last returned row so overshoot items aren't lost", async () => {
    const ctx = makeCtx();
    // Three rows that all pass `filter=upcoming`. With limit=1 the 3x overshoot
    // fetches all three in one window; the slice returns one item but the
    // remaining two must be visible on the next page.
    const futureYear = new Date().getUTCFullYear() + 5;
    await repo.bulkInsertIgnoreConflict(
      ctx.userId,
      [{ tmdbId: "961", mediaType: "movie" }],
      "manual",
      false,
      300,
    );
    await repo.bulkInsertIgnoreConflict(
      ctx.userId,
      [{ tmdbId: "962", mediaType: "movie" }],
      "manual",
      false,
      200,
    );
    await repo.bulkInsertIgnoreConflict(
      ctx.userId,
      [{ tmdbId: "963", mediaType: "movie" }],
      "manual",
      false,
      100,
    );
    __resetAvailabilityCache();
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:961": { tmdbId: "961", mediaType: "movie", title: "A", year: futureYear, genres: [] },
      "movie:962": { tmdbId: "962", mediaType: "movie", title: "B", year: futureYear, genres: [] },
      "movie:963": { tmdbId: "963", mediaType: "movie", title: "C", year: futureYear, genres: [] },
    });

    const page1 = await getItems(ctx, { limit: 1, filter: "upcoming" });
    expect(page1.items.map((i) => i.tmdbId)).toEqual(["961"]);
    expect(page1.cursor).not.toBeNull();
    const page2 = await getItems(ctx, { limit: 1, filter: "upcoming", cursor: page1.cursor! });
    // Bug under fix: the old code anchored the cursor at the last DB-scanned
    // row (963) and skipped 962 and 963 entirely. The fix anchors at the last
    // *returned* row (961), so the next page picks up 962.
    expect(page2.items.map((i) => i.tmdbId)).toEqual(["962"]);
  });

  it("availability cache is shared between a list + counts pair (one probe per row)", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "950", mediaType: "movie" }, "manual", ctx);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const probeSpy = ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>;
    probeSpy.mockClear();

    await getItems(ctx, { limit: 10 });
    const afterList = probeSpy.mock.calls.length;
    await getCounts(ctx);
    const afterCounts = probeSpy.mock.calls.length;
    // The counts pass should hit the cache for the same key — no new probe.
    expect(afterCounts).toBe(afterList);
  });
});

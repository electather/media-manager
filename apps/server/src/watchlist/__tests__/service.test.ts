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
  addItem,
  removeItem,
  listAvailable,
  listItems,
  listMoodItems,
  seedFromPlugins,
  syncFromPlugins,
} = await import("../service");
const mediaRepo = await import("../../media/repo");
const { __resetAvailabilityCache } = await import("../../media");

let testDb: Db;

const log: ConsolaInstance = consola.withTag("test");

function makeMediaService(
  overrides: Partial<{
    getWatchlistFeed: ReturnType<typeof vi.fn>;
    getStatusBatch: ReturnType<typeof vi.fn>;
    getMatchingServers: ReturnType<typeof vi.fn>;
    getMetadata: ReturnType<typeof vi.fn>;
    getContinueWatchingFeed: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    getWatchlistFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getStatusBatch: vi.fn().mockResolvedValue({}),
    getMatchingServers: vi.fn().mockResolvedValue([]),
    getMetadata: vi.fn().mockResolvedValue(null),
    getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    ...overrides,
  };
}

function makeCatalog() {
  return {
    // Resolve canonical metadata for every requested key by default so each
    // active row surfaces as a real item — the normal case. enrich now drops
    // rows whose id resolves to no metadata (a dead/stale tmdb mapping), so a
    // bare `{}` here would silently drop every row. Tests that need specific
    // titles/genres (or the unresolved-drop) override this per call.
    getMetadataBatch: vi.fn(async (keys: Array<{ tmdbId: string; type: "movie" | "tv" }>) =>
      Object.fromEntries(
        keys.map(({ tmdbId, type }) => [
          `${type}:${tmdbId}`,
          { tmdbId, mediaType: type, title: tmdbId, genres: [] },
        ]),
      ),
    ),
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
  await testDb.insert(user).values([
    {
      id: "u1",
      name: "u1",
      email: "u1@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "u2",
      name: "u2",
      email: "u2@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await mediaRepo.__resetActiveRowsForTests(testDb);
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
    expect(await mediaRepo.hasUserSeeded(ctx.userId)).toBe(false);

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
    expect(await mediaRepo.hasUserSeeded(ctx.userId)).toBe(false);
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
    const row = await mediaRepo.getActiveRow(ctx.userId, { tmdbId: "400", mediaType: "movie" });
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
    const row = await mediaRepo.getActiveRow(ctx.userId, { tmdbId: "600", mediaType: "movie" });
    expect(row?.state).toBe("active");
  });
});

describe("watchlist/service v2 (pagination + filter)", () => {
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

  // Regression: when a single keyset overshoot window yields fewer than
  // `limit` mood matches, `listMoodItems` MUST keep scanning the next
  // window(s) until the page is filled (up to MAX_EMPTY_HOPS). The first
  // version broke at the first non-empty hop, so sparse moods truncated to
  // a single item even when more matches existed deeper in the user's set.
  it("listMoodItems accumulates matches across hops when the mood is sparse", async () => {
    const ctx = makeCtx();
    // fetchSize = limit (3) * OVERSHOOT_FACTOR (3) = 9. Seed 12 rows so the
    // scan covers two windows: hop1 = m12..m4 (9 rows), hop2 = m3..m1 (3 rows).
    for (let i = 1; i <= 12; i++) {
      await addItem({ tmdbId: `m${i}`, mediaType: "movie" }, "manual", ctx);
    }
    // 1 dark match in hop1 (m4) + 2 dark matches in hop2 (m3, m2).
    const dark = new Set(["m4", "m3", "m2"]);
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: { tmdbId: string; type: "movie" | "tv" }[]) => {
        const out: Record<string, unknown> = {};
        for (const { tmdbId } of keys) {
          if (dark.has(tmdbId)) {
            out[`movie:${tmdbId}`] = {
              tmdbId,
              mediaType: "movie",
              title: tmdbId,
              genres: ["Horror"],
            };
          }
        }
        return out;
      },
    );

    const res = await listMoodItems(ctx, "dark", { limit: 3 });
    expect(res.items.map((i) => i.tmdbId)).toEqual(["m4", "m3", "m2"]);
  });

  // Regression: when matches are scattered DEEP across many overshoot
  // windows (e.g. user has 40+ rows and the mood only fires every 15-20
  // rows), the loop MUST keep scanning while it's still making progress.
  // An earlier fix capped total hops at 3 — large sparse watchlists then
  // returned 1 or 2 items even though the summary endpoint claimed `count`
  // ≥ MIN_CLUSTER_SIZE. Underfilled hops no longer burn the budget.
  it("listMoodItems scans past the empty-hop budget when each hop still adds matches", async () => {
    const ctx = makeCtx();
    // 36 rows, fetchSize = 9. Plant 1 dark match every 12 rows so the page
    // fills only after 3 + windows of scanning.
    for (let i = 1; i <= 36; i++) {
      await addItem({ tmdbId: `m${i}`, mediaType: "movie" }, "manual", ctx);
    }
    // addItem inserts in id-asc order; repo.listPage returns by addedAt DESC.
    // m36 sits in hop 1, m24 in hop 2, m12 in hop 3 — each hop adds 1 item.
    const dark = new Set(["m36", "m24", "m12"]);
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: { tmdbId: string; type: "movie" | "tv" }[]) => {
        const out: Record<string, unknown> = {};
        for (const { tmdbId } of keys) {
          if (dark.has(tmdbId)) {
            out[`movie:${tmdbId}`] = {
              tmdbId,
              mediaType: "movie",
              title: tmdbId,
              genres: ["Horror"],
            };
          }
        }
        return out;
      },
    );

    const res = await listMoodItems(ctx, "dark", { limit: 3 });
    expect(res.items.map((i) => i.tmdbId)).toEqual(["m36", "m24", "m12"]);
  });

  it("listMoodItems returns cursor=null when the empty-streak budget exits with no matches", async () => {
    const ctx = makeCtx();
    for (let i = 1; i <= 9; i++) {
      await addItem({ tmdbId: `m${i}`, mediaType: "movie" }, "manual", ctx);
    }

    const res = await listMoodItems(ctx, "dark", { limit: 1 });

    expect(res.items).toEqual([]);
    expect(res.cursor).toBeNull();
  });

  // V.WL1 — `sort=alpha` returns rows by canonical-metadata title ascending,
  // not by `addedAt`. Anchors the offset-cursor sort path.
  it("listItems sort=alpha sorts by metadata title", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "a1", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "a2", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "a3", mediaType: "movie" }, "manual", ctx);
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:a1": { tmdbId: "a1", mediaType: "movie", title: "Charlie", genres: [] },
      "movie:a2": { tmdbId: "a2", mediaType: "movie", title: "Alpha", genres: [] },
      "movie:a3": { tmdbId: "a3", mediaType: "movie", title: "Bravo", genres: [] },
    });

    const page = await listItems(ctx, { sort: "alpha", limit: 10 });
    expect(page.items.map((i) => i.tmdbId)).toEqual(["a2", "a3", "a1"]);
  });

  // V.WL2 — when most rows in the offset window are dropped by the bucket
  // filter, the next cursor MUST still advance past the scanned rows; an
  // earlier cursor that advanced by `slice.length` produced a load-more
  // loop or duplicated rows. Anchors the `scannedRows` fix.
  it("listItems sort=alpha + sparse bucket advances cursor past scanned window", async () => {
    const ctx = makeCtx();
    // 9 rows; only `r5` is ready (server-mapped). Bucket filter keeps 1 row;
    // the request asks for limit=10 so we should NOT be told there is more.
    for (let i = 1; i <= 9; i++) {
      await addItem({ tmdbId: `r${i}`, mediaType: "movie" }, "manual", ctx);
    }
    __resetAvailabilityCache();
    (ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>).mockImplementation(
      async (tmdbId: string) => (tmdbId === "r5" ? [{ id: "jellyfin", label: "Jellyfin" }] : []),
    );
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: { tmdbId: string; type: "movie" | "tv" }[]) => {
        const out: Record<string, unknown> = {};
        for (const { tmdbId } of keys) {
          out[`movie:${tmdbId}`] = { tmdbId, mediaType: "movie", title: tmdbId, genres: [] };
        }
        return out;
      },
    );

    const page = await listItems(ctx, { sort: "alpha", bucket: "ready", limit: 10 });
    expect(page.items.map((i) => i.tmdbId)).toEqual(["r5"]);
    // Critical: cursor must be null — every row in the active set has been
    // classified, so there is nothing left to paginate.
    expect(page.cursor).toBeNull();
  });

  // Shared sparse-bucket scaffolding for the regression suite: seed N alpha
  // rows and stub the ready set + uniform alpha-title metadata.
  async function seedSparseAlphaBucket(
    ctx: ReturnType<typeof makeCtx>,
    rowCount: number,
    ready: Set<string>,
  ): Promise<void> {
    for (let i = 1; i <= rowCount; i++) {
      await addItem(
        { tmdbId: `a${String(i).padStart(2, "0")}`, mediaType: "movie" },
        "manual",
        ctx,
      );
    }
    __resetAvailabilityCache();
    (ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>).mockImplementation(
      async (tmdbId: string) => (ready.has(tmdbId) ? [{ id: "jellyfin", label: "Jellyfin" }] : []),
    );
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: { tmdbId: string; type: "movie" | "tv" }[]) => {
        const out: Record<string, unknown> = {};
        for (const { tmdbId } of keys) {
          out[`movie:${tmdbId}`] = { tmdbId, mediaType: "movie", title: tmdbId, genres: [] };
        }
        return out;
      },
    );
  }

  // Regression for issue #501: sparse bucket+sort must return ≥ min(limit,
  // total-bucket-rows) per page even when matching rows sit past the first
  // OVERSHOOT_FACTOR window. Single-pass over the in-memory tail handles
  // this without a retry loop.
  it("listItems sort=alpha + sparse bucket fills page across the full sorted tail", async () => {
    const ctx = makeCtx();
    // 20 rows; ready items at a03, a15, a18 — a15 and a18 sit past the old
    // 15-row overshoot window. Single-pass returns all 3.
    await seedSparseAlphaBucket(ctx, 20, new Set(["a03", "a15", "a18"]));

    const page = await listItems(ctx, { sort: "alpha", bucket: "ready", limit: 5 });
    expect(page.items.map((i) => i.tmdbId)).toEqual(["a03", "a15", "a18"]);
    expect(page.cursor).toBeNull();
  });

  // Multi-page coverage for the same scenario: V.WL1 best-effort stability
  // through `scannedRowCount` must resume on row a15 with no repeats.
  it("listItems sort=alpha + sparse bucket pages through matches across cursor hops", async () => {
    const ctx = makeCtx();
    await seedSparseAlphaBucket(ctx, 20, new Set(["a03", "a15", "a18"]));

    const page1 = await listItems(ctx, { sort: "alpha", bucket: "ready", limit: 2 });
    expect(page1.items.map((i) => i.tmdbId)).toEqual(["a03", "a15"]);
    expect(page1.cursor).not.toBeNull();
    const page2 = await listItems(ctx, {
      sort: "alpha",
      bucket: "ready",
      limit: 2,
      cursor: page1.cursor!,
    });
    expect(page2.items.map((i) => i.tmdbId)).toEqual(["a18"]);
    expect(page2.cursor).toBeNull();
  });

  // No-bucket cursor stability: scannedRowCount must advance by the returned
  // page size (not by the bounded OVERSHOOT window) so page 2 resumes at the
  // next row with no repeats.
  it("listItems sort=alpha without bucket advances cursor by returned rows", async () => {
    const ctx = makeCtx();
    await seedSparseAlphaBucket(ctx, 20, new Set());

    const page1 = await listItems(ctx, { sort: "alpha", limit: 5 });
    expect(page1.items.map((i) => i.tmdbId)).toEqual(["a01", "a02", "a03", "a04", "a05"]);
    expect(page1.cursor).not.toBeNull();
    const page2 = await listItems(ctx, { sort: "alpha", limit: 5, cursor: page1.cursor! });
    expect(page2.items.map((i) => i.tmdbId)).toEqual(["a06", "a07", "a08", "a09", "a10"]);
    expect(page2.cursor).not.toBeNull();
  });

  // V.WL2 rev 6 — `bucket` omitted surfaces every active row regardless of
  // classification (no hidden `unknown` tail leak).
  it("listItems without bucket surfaces every active row across visible buckets", async () => {
    const ctx = makeCtx();
    await addItem({ tmdbId: "v1", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "v2", mediaType: "movie" }, "manual", ctx);
    await addItem({ tmdbId: "v3", mediaType: "movie" }, "manual", ctx);
    __resetAvailabilityCache();
    (ctx.mediaService.getMatchingServers as ReturnType<typeof vi.fn>).mockImplementation(
      async (tmdbId: string) => (tmdbId === "v1" ? [{ id: "jellyfin", label: "Jellyfin" }] : []),
    );
    // All three rows resolve to real metadata so they are not dropped; their
    // buckets still differ (v1 available via server, v2 upcoming via future
    // year, v3 unknown — no server, no future date), which is what this test
    // exercises: an omitted bucket surfaces every active row regardless of
    // classification.
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:v1": { tmdbId: "v1", mediaType: "movie", title: "v1", genres: [] },
      "movie:v2": {
        tmdbId: "v2",
        mediaType: "movie",
        title: "Far Future",
        year: new Date().getUTCFullYear() + 3,
        genres: [],
      },
      "movie:v3": { tmdbId: "v3", mediaType: "movie", title: "v3", genres: [] },
    });

    const page = await listItems(ctx, { limit: 10 });
    expect(new Set(page.items.map((i) => i.tmdbId))).toEqual(new Set(["v1", "v2", "v3"]));
  });
});

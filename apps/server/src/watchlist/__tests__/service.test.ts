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
const { getItems, addItem, removeItem, listAvailable, seedFromPlugins, syncFromPlugins } =
  await import("../service");
const repo = await import("../repo");

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

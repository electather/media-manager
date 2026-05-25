import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../../db/client", async () => {
  const actual = await vi.importActual<typeof import("../../../db/client")>("../../../db/client");
  return { ...actual, getDb: () => testDb };
});

vi.mock("../../availability-cache", () => ({
  getMatchingServersCached: vi.fn().mockResolvedValue([]),
  __resetAvailabilityCache: vi.fn(),
}));

vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    loadProgressMap: vi.fn().mockResolvedValue({ map: new Map(), partial: false }),
  };
});

vi.mock("../../enrich", () => ({
  enrich: vi.fn().mockResolvedValue({ items: [], partial: false, sources: [] }),
}));

const { getMatchingServersCached } = await import("../../availability-cache");
const { loadProgressMap } = await import("../../../media");
const { enrich } = await import("../../enrich");
const { getSection, __resetTonightCache } = await import("../section");
const repo = await import("../../repo");

let testDb: Db;

const log = consola.withTag("test");

function makeCtx(userId = "u1") {
  return {
    userId,
    mediaService: {
      getStatusBatch: vi.fn().mockResolvedValue({}),
      getMatchingServers: vi.fn().mockResolvedValue([]),
      getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    } as unknown as Parameters<typeof getSection>[0]["mediaService"],
    catalog: {
      getMetadataBatch: vi.fn().mockResolvedValue({}),
    } as unknown as Parameters<typeof getSection>[0]["catalog"],
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
  __resetTonightCache();
  vi.mocked(getMatchingServersCached).mockResolvedValue([]);
  vi.mocked(loadProgressMap).mockResolvedValue({ map: new Map(), partial: false });
  vi.mocked(enrich).mockResolvedValue({ items: [], partial: false, sources: [] });
});

describe("tonight/section — getSection", () => {
  it("returns empty when the user has no active rows", async () => {
    const result = await getSection(makeCtx());
    expect(result).toEqual({ items: [], partial: false });
  });

  it("fans out server probes via Promise.allSettled (concurrency pin)", async () => {
    const ROW_COUNT = 3;
    await repo.bulkInsertIgnoreConflict(
      "u1",
      [
        { tmdbId: "1", mediaType: "movie" },
        { tmdbId: "2", mediaType: "movie" },
        { tmdbId: "3", mediaType: "tv" },
      ],
      "manual",
      false,
      Date.now(),
      testDb,
    );

    const allSettledSpy = vi.spyOn(Promise, "allSettled");

    await getSection(makeCtx());

    // Exactly one allSettled call should have received an array of ROW_COUNT promises —
    // the server-probe fan-out. This pins that no per-row sequential await replaced it.
    const probeCall = allSettledSpy.mock.calls.find(
      ([iterable]) => Array.isArray(iterable) && (iterable as unknown[]).length === ROW_COUNT,
    );
    expect(probeCall).toBeDefined();

    allSettledSpy.mockRestore();
  });

  it("pre-filters: only ready and in-progress rows reach enrich", async () => {
    const now = Date.now();
    await repo.bulkInsertIgnoreConflict(
      "u1",
      [
        { tmdbId: "ready-1", mediaType: "movie" },
        { tmdbId: "inprog-2", mediaType: "movie" },
        { tmdbId: "unavail-3", mediaType: "movie" },
      ],
      "manual",
      false,
      now,
      testDb,
    );

    // "ready-1" has a matching server → bucket = ready
    vi.mocked(getMatchingServersCached).mockImplementation((_userId, _svc, tmdbId) =>
      Promise.resolve(tmdbId === "ready-1" ? [{ id: "jf", label: "Jellyfin" }] : []),
    );
    // "inprog-2" has an in-progress progress entry
    vi.mocked(loadProgressMap).mockResolvedValue({
      map: new Map([["movie:inprog-2", { watched: 200, total: 1000 }]]),
      partial: false,
    });
    // "unavail-3" has no server and no progress → bucket = unavailable

    vi.mocked(enrich).mockResolvedValue({ items: [], partial: false, sources: [] });

    await getSection(makeCtx());

    // enrich should only be called with the two qualifying candidates
    expect(enrich).toHaveBeenCalledOnce();
    const candidates = vi.mocked(enrich).mock.calls[0]![0] as { tmdbId: string }[];
    const candidateTmdbIds = candidates.map((r) => r.tmdbId);
    expect(candidateTmdbIds).toContain("ready-1");
    expect(candidateTmdbIds).toContain("inprog-2");
    expect(candidateTmdbIds).not.toContain("unavail-3");
  });

  it("returns cached result on second call without re-fetching rows", async () => {
    await repo.bulkInsertIgnoreConflict(
      "u1",
      [{ tmdbId: "10", mediaType: "movie" }],
      "manual",
      false,
      Date.now(),
      testDb,
    );

    const ctx = makeCtx();
    await getSection(ctx);
    await getSection(ctx);

    // listAllActive is called via repo which hits the DB; getStatusBatch is on the service mock
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.mediaService.getStatusBatch).toHaveBeenCalledOnce();
  });
});

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

vi.mock("../../../media/availability-cache", () => ({
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

vi.mock("../../../media/enrich", () => ({
  enrich: vi.fn().mockResolvedValue({ items: [], partial: false, sources: [] }),
}));

const { getMatchingServersCached } = await import("../../../media/availability-cache");
const { loadProgressMap } = await import("../../../media");
const { enrich } = await import("../../../media/enrich");
const { getSection, __resetTonightCache } = await import("../section");
const mediaRepo = await import("../../../media/repo");

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
  vi.clearAllMocks();
  await mediaRepo.__resetActiveRowsForTests(testDb);
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

  it("resilient fan-out: rejected probe does not block other rows from pre-filtering", async () => {
    // If the implementation used Promise.all, a single rejection would abort the
    // entire batch and no row would reach enrich. Promise.allSettled lets the
    // non-failing rows proceed — this test fails if Promise.all is substituted.
    await mediaRepo.bulkInsertActiveRows(
      "u1",
      [
        { tmdbId: "ok-1", mediaType: "movie" },
        { tmdbId: "fail-2", mediaType: "movie" },
      ],
      "manual",
      false,
      Date.now(),
      testDb,
    );

    vi.mocked(getMatchingServersCached).mockImplementation((_userId, _svc, tmdbId) =>
      tmdbId === "fail-2"
        ? Promise.reject(new Error("probe timeout"))
        : Promise.resolve([{ id: "jf", label: "Jellyfin" }] as unknown as Awaited<
            ReturnType<typeof getMatchingServersCached>
          >),
    );

    await getSection(makeCtx());

    expect(enrich).toHaveBeenCalledOnce();
    const candidates = vi.mocked(enrich).mock.calls[0]![0] as { tmdbId: string }[];
    expect(candidates.map((r) => r.tmdbId)).toContain("ok-1");
    expect(candidates.map((r) => r.tmdbId)).not.toContain("fail-2");
  });

  it("pre-filters: only ready and in-progress rows reach enrich", async () => {
    const now = Date.now();
    await mediaRepo.bulkInsertActiveRows(
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

  it("returns cached result on second call without re-invoking getStatusBatch", async () => {
    await mediaRepo.bulkInsertActiveRows(
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

    // getStatusBatch is the cheapest observable proxy for whether section re-fetched on the second call.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.mediaService.getStatusBatch).toHaveBeenCalledOnce();
  });
});

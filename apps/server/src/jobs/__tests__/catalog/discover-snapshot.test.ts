import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const discoverFeedMock = vi.fn();
class FakeMediaService {
  async discoverFeed(...args: unknown[]) {
    return discoverFeedMock(...args);
  }
}
vi.mock("../../../media/service", () => ({ MediaService: FakeMediaService }));

const { cleanupInMemoryDbs, createInMemoryDb } =
  await import("../../../__tests__/helpers/in-memory-db");
const { CatalogService } = await import("../../../catalog/service");
const { runCatalogDiscoverSnapshot } = await import("../../../catalog/jobs/discover-snapshot");
import type { JobRunContext } from "../../types";

afterAll(() => cleanupInMemoryDbs());

const DAY_MS = 24 * 60 * 60 * 1000;

function buildJobCtx(overrides: Partial<JobRunContext> = {}): JobRunContext {
  return {
    runId: "run-1",
    triggeredBy: "cron",
    requestId: "req-1",
    logger: consola,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe("host.catalog.discover_snapshot handler", () => {
  it("writes one snapshot per (kind, sort) tuple and warms canonical_metadata", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    discoverFeedMock.mockReset().mockResolvedValue({
      items: [
        {
          id: "movie:1",
          type: "movie",
          title: "Item 1",
          ids: { tmdb_id: "1" },
        },
      ],
      partial: false,
    });

    await runCatalogDiscoverSnapshot({ catalog }, buildJobCtx());

    expect(discoverFeedMock).toHaveBeenCalledTimes(4);

    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    expect(await catalog.getDiscoverFeed("newReleases", "popularity_desc", today)).toEqual([
      { tmdbId: "1", type: "movie" },
    ]);
    expect(await catalog.getDiscoverFeed("trending", "popularity_desc", today)).not.toBeNull();
    expect(await catalog.getDiscoverFeed("upcoming", "release_date_asc", today)).not.toBeNull();
    expect(await catalog.getDiscoverFeed("popular", "popularity_desc", today)).not.toBeNull();

    const persisted = await catalog.getMetadata("1", "movie");
    expect(persisted?.title).toBe("Item 1");
  });

  it("aborts before issuing any dispatch when the signal is pre-aborted", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const aborter = new AbortController();
    aborter.abort(new Error("cancelled"));
    discoverFeedMock.mockReset();

    await expect(
      runCatalogDiscoverSnapshot({ catalog }, buildJobCtx({ abortSignal: aborter.signal })),
    ).rejects.toThrow();
    expect(discoverFeedMock).not.toHaveBeenCalled();
  });

  it("skips empty results without writing the snapshot", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    discoverFeedMock.mockReset().mockResolvedValue({ items: [], partial: false });

    await runCatalogDiscoverSnapshot({ catalog }, buildJobCtx());

    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    expect(await catalog.getDiscoverFeed("newReleases", "popularity_desc", today)).toBeNull();
  });

  // Regression: a previous implementation collected refs and canonical rows
  // in two passes, then paired them by index. When any item failed key
  // resolution (no `tmdb_id`), the refs array shifted but the canonical
  // pairing did not, persisting rows with misaligned IDs and titles.
  it("aligns refs with their canonical rows when an item lacks a tmdb_id", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    discoverFeedMock.mockReset().mockResolvedValue({
      items: [
        // First item has no resolvable id and must be dropped.
        { id: "movie:", type: "movie", title: "Dropped", ids: {} },
        { id: "movie:7", type: "movie", title: "Item Seven", ids: { tmdb_id: "7" } },
      ],
      partial: false,
    });

    await runCatalogDiscoverSnapshot({ catalog }, buildJobCtx());

    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const refs = await catalog.getDiscoverFeed("newReleases", "popularity_desc", today);
    expect(refs).toEqual([{ tmdbId: "7", type: "movie" }]);

    const persisted = await catalog.getMetadata("7", "movie");
    expect(persisted?.title).toBe("Item Seven");
  });
});

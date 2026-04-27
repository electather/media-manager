import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const getMetadataMock = vi.fn();
class FakeMediaService {
  async getMetadata(...args: unknown[]) {
    return getMetadataMock(...args);
  }
}
vi.mock("../../../media/service", () => ({ MediaService: FakeMediaService }));

const { cleanupInMemoryDbs, createInMemoryDb } =
  await import("../../../__tests__/helpers/in-memory-db");
const { CatalogService } = await import("../../../catalog");
const { toCanonicalRow } = await import("../../../catalog/canonical");
const { runCatalogMetadataRefresh } = await import("../../../catalog/jobs/metadata-refresh");
import type { JobRunContext } from "../../types";

afterAll(() => cleanupInMemoryDbs());

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

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

describe("host.catalog.metadata_refresh handler", () => {
  it("returns early when no rows are stale", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    getMetadataMock.mockReset();

    await runCatalogMetadataRefresh({ catalog }, buildJobCtx());

    expect(getMetadataMock).not.toHaveBeenCalled();
  });

  it("dispatches stale rows in batches and writes refreshed payloads back", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const now = Date.now();
    const stale = toCanonicalRow(
      { tmdbId: "550", type: "movie" },
      { title: "old", type: "movie", ids: { tmdb_id: "550" } },
      now - STALE_AFTER_MS - 1,
    );
    await catalog.writeMetadata([stale]);

    getMetadataMock.mockReset().mockResolvedValueOnce({
      title: "Fight Club (refreshed)",
      type: "movie",
      year: 1999,
      runtime: 139,
      genres: ["Drama"],
      keywords: ["dark"],
      cast: ["Edward Norton"],
      director: "David Fincher",
      writers: ["Jim Uhls"],
      ids: { tmdb_id: "550" },
    });

    await runCatalogMetadataRefresh({ catalog }, buildJobCtx());

    expect(getMetadataMock).toHaveBeenCalledOnce();
    expect(getMetadataMock).toHaveBeenCalledWith("550", "movie");

    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.title).toBe("Fight Club (refreshed)");
    expect(persisted?.features?.director).toBe("David Fincher");
  });

  it("aborts mid-loop when the signal fires", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const now = Date.now();
    const old = now - STALE_AFTER_MS - 1;
    // Seed enough rows to span several batches so the abort actually fires.
    const rows = Array.from({ length: 60 }, (_, i) =>
      toCanonicalRow(
        { tmdbId: String(i), type: "movie" },
        { title: `r-${i}`, type: "movie", ids: { tmdb_id: String(i) } },
        old,
      ),
    );
    await catalog.writeMetadata(rows);

    const aborter = new AbortController();
    aborter.abort(new Error("cancelled"));
    getMetadataMock.mockReset().mockResolvedValue(null);

    await expect(
      runCatalogMetadataRefresh({ catalog }, buildJobCtx({ abortSignal: aborter.signal })),
    ).rejects.toThrow();
    // The signal is aborted before the loop runs, so `throwIfAborted` fires
    // on the first iteration before any dispatch can be issued.
    expect(getMetadataMock).not.toHaveBeenCalled();
  });
});

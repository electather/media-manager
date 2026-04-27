import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";
import type { ArtworkBundle, ArtworkIdMap } from "@ent-mcp/shared/artwork";

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

const fetchArtworkBundleMock =
  vi.fn<
    (
      userId: string,
      key: { tmdbId: string; type: "movie" | "tv" },
      ids: ArtworkIdMap,
    ) => Promise<ArtworkBundle | null>
  >();
vi.mock("../../../catalog/artwork-fetch", async () => {
  const actual = await vi.importActual<typeof import("../../../catalog/artwork-fetch")>(
    "../../../catalog/artwork-fetch",
  );
  return {
    ...actual,
    fetchArtworkBundle: (...args: Parameters<typeof actual.fetchArtworkBundle>) =>
      fetchArtworkBundleMock(...args),
  };
});

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
  beforeEach(() => {
    fetchArtworkBundleMock.mockReset().mockResolvedValue(null);
  });

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

  it("merges artwork@v1 bundle into the refreshed row (V46)", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const old = Date.now() - STALE_AFTER_MS - 1;
    await catalog.writeMetadata([
      toCanonicalRow(
        { tmdbId: "550", type: "movie" },
        { title: "old", type: "movie", ids: { tmdb_id: "550" } },
        old,
      ),
    ]);

    getMetadataMock.mockReset().mockResolvedValueOnce({
      title: "Fight Club",
      type: "movie",
      year: 1999,
      ids: { tmdb_id: "550" },
    });
    fetchArtworkBundleMock.mockResolvedValueOnce({
      poster: [{ url: "https://art/poster.jpg", language: "en" }],
      backdrop: [{ url: "https://art/backdrop.jpg", language: "00" }],
      clearLogo: [{ url: "https://art/logo.png", language: "en" }],
      thumb: [{ url: "https://art/thumb.jpg", language: "en" }],
    });

    await runCatalogMetadataRefresh({ catalog }, buildJobCtx());

    expect(fetchArtworkBundleMock).toHaveBeenCalledOnce();
    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.posterUrl).toBe("https://art/poster.jpg");
    expect(persisted?.backdropUrl).toBe("https://art/backdrop.jpg");
    expect(persisted?.clearLogoUrl).toBe("https://art/logo.png");
    expect(persisted?.thumbUrl).toBe("https://art/thumb.jpg");
  });

  it("writes a metadata-only row when artwork@v1 fails (V46 — degrade-quiet)", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const old = Date.now() - STALE_AFTER_MS - 1;
    await catalog.writeMetadata([
      toCanonicalRow(
        { tmdbId: "550", type: "movie" },
        { title: "old", type: "movie", ids: { tmdb_id: "550" } },
        old,
      ),
    ]);

    getMetadataMock.mockReset().mockResolvedValueOnce({
      title: "Fight Club",
      type: "movie",
      ids: { tmdb_id: "550" },
    });
    fetchArtworkBundleMock.mockResolvedValueOnce(null);

    await runCatalogMetadataRefresh({ catalog }, buildJobCtx());

    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.title).toBe("Fight Club");
    expect(persisted?.posterUrl).toBeNull();
    expect(persisted?.clearLogoUrl).toBeNull();
  });

  it("threads id_map ids into the artwork dispatch (V46 — second-pass populates logos/thumbs)", async () => {
    const db = await createInMemoryDb();
    const catalog = new CatalogService(db);
    const old = Date.now() - STALE_AFTER_MS - 1;
    await catalog.writeMetadata([
      toCanonicalRow(
        { tmdbId: "550", type: "movie" },
        { title: "old", type: "movie", ids: { tmdb_id: "550" } },
        old,
      ),
    ]);
    // Seed an `id_map` row so the refresh's `getMetadataWithIds` join hands
    // imdb/tvdb ids to the artwork dispatch.
    const { idMap } = await import("../../../db/schema/id-map");
    await db.insert(idMap).values({
      tmdbId: "550",
      mediaType: "movie",
      imdbId: "tt0137523",
      tvdbId: "12345",
      updatedAt: Date.now(),
    });

    getMetadataMock.mockReset().mockResolvedValueOnce({
      title: "Fight Club",
      type: "movie",
      ids: { tmdb_id: "550" },
    });
    fetchArtworkBundleMock.mockImplementationOnce(async (_userId, _key, ids) => {
      // Logos + thumbs only available when imdb/tvdb ids are present.
      if (ids.imdb && ids.tvdb) {
        return {
          poster: [{ url: "https://art/poster.jpg", language: "en" }],
          backdrop: [{ url: "https://art/backdrop.jpg", language: "00" }],
          clearLogo: [{ url: "https://art/logo.png", language: "en" }],
          thumb: [{ url: "https://art/thumb.jpg", language: "en" }],
        };
      }
      return {
        poster: [{ url: "https://art/poster.jpg", language: "en" }],
        backdrop: [{ url: "https://art/backdrop.jpg", language: "00" }],
        clearLogo: [],
        thumb: [],
      };
    });

    await runCatalogMetadataRefresh({ catalog }, buildJobCtx());

    expect(fetchArtworkBundleMock).toHaveBeenCalledOnce();
    const dispatchedIds = fetchArtworkBundleMock.mock.calls[0]?.[2];
    expect(dispatchedIds?.tmdb).toBe("550");
    expect(dispatchedIds?.imdb).toBe("tt0137523");
    expect(dispatchedIds?.tvdb).toBe("12345");

    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.clearLogoUrl).toBe("https://art/logo.png");
    expect(persisted?.thumbUrl).toBe("https://art/thumb.jpg");
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

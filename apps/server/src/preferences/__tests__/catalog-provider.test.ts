/* eslint-disable @typescript-eslint/unbound-method --
 * Tests assert on `vi.fn()` spies hung off a fallback record. The "unbound"
 * warning is noise — the spies are read as values, never invoked detached.
 */
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { cleanupInMemoryDbs, createInMemoryDb } from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../../catalog/service";
import { toCanonicalRow } from "../../catalog/canonical";
import { CatalogPreferenceProvider } from "../catalog-provider";
import type { HistorySignal, PreferenceDataProvider } from "../provider";
import type { CandidateFeatures } from "../types";

afterAll(() => cleanupInMemoryDbs());

const FALLBACK_FEATURES: CandidateFeatures = {
  id: "movie:550",
  type: "movie",
  title: "Fight Club",
  year: 1999,
  runtime: 139,
  genres: ["Drama"],
  keywords: ["dark", "thriller"],
  cast: ["Edward Norton"],
  director: "David Fincher",
  writers: ["Jim Uhls"],
  creators: [],
  originalLanguage: "en",
};

function makeFallback(overrides: Partial<PreferenceDataProvider> = {}): PreferenceDataProvider {
  return {
    getItemFeatures: vi.fn(async () => FALLBACK_FEATURES),
    getHistory: vi.fn(async () => []),
    getAllRatings: vi.fn(async () => []),
    getWatchlist: vi.fn(async () => []),
    getComments: vi.fn(async () => []),
    ...overrides,
  };
}

describe("CatalogPreferenceProvider", () => {
  it("serves features from the catalog without invoking the fallback", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([
      toCanonicalRow(
        { tmdbId: "550", type: "movie" },
        { ...FALLBACK_FEATURES, ids: { tmdb_id: "550" } },
      ),
    ]);
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    const features = await provider.getItemFeatures("u1", "550", "movie");
    expect(features?.title).toBe("Fight Club");
    expect(fallback.getItemFeatures).not.toHaveBeenCalled();
  });

  it("falls back to the wrapped provider on a miss and persists the result", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    const features = await provider.getItemFeatures("u1", "550", "movie");
    expect(features?.title).toBe("Fight Club");
    expect(fallback.getItemFeatures).toHaveBeenCalledOnce();

    // Wait one tick so the detached cold-fill `void writeMetadata(...)` runs.
    await new Promise((resolve) => setImmediate(resolve));

    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.features?.director).toBe("David Fincher");
  });

  it("returns null when the fallback yields no features", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const fallback = makeFallback({ getItemFeatures: vi.fn(async () => null) });
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    const result = await provider.getItemFeatures("u1", "missing", "movie");
    expect(result).toBeNull();
  });

  it("swallows write-back failures without dropping the read", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const writeSpy = vi.spyOn(catalog, "writeMetadata").mockRejectedValue(new Error("boom"));
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    const features = await provider.getItemFeatures("u1", "550", "movie");
    expect(features?.title).toBe("Fight Club");
    await new Promise((resolve) => setImmediate(resolve));
    expect(writeSpy).toHaveBeenCalled();
  });

  it("delegates history, ratings, watchlist, and comments unchanged", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const history: HistorySignal[] = [
      { tmdbId: "1", mediaType: "movie", watchedAt: 1, progress: 1 },
    ];
    const fallback = makeFallback({ getHistory: vi.fn(async () => history) });
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    expect(await provider.getHistory("u1")).toHaveLength(1);
    expect(fallback.getHistory).toHaveBeenCalledWith("u1");
    expect(await provider.getAllRatings("u1")).toEqual([]);
    expect(await provider.getWatchlist("u1")).toEqual([]);
    expect(await provider.getComments("u1")).toEqual([]);
  });
});

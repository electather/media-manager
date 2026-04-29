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
    // Yield two macrotask turns so the detached `void coldFill(...).catch(log)`
    // chain settles. `setTimeout(0)` is portable across Node, Bun, and the
    // Vitest browser runner; `setImmediate` is Node-only.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

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
    // Yield two macrotask turns so the detached `void coldFill(...).catch(log)`
    // chain settles. `setTimeout(0)` is portable across Node, Bun, and the
    // Vitest browser runner; `setImmediate` is Node-only.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeSpy).toHaveBeenCalled();
  });

  it("falls back to the live provider for history when the mirror is empty", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const history: HistorySignal[] = [
      { tmdbId: "1", mediaType: "movie", watchedAt: 1, progress: 1 },
    ];
    const fallback = makeFallback({ getHistory: vi.fn(async () => history) });
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    expect(await provider.getHistory("u1")).toHaveLength(1);
    expect(fallback.getHistory).toHaveBeenCalledWith("u1");
  });

  it("serves history from the catalog mirror when populated", async () => {
    const db = await createInMemoryDb();
    const catalog = new CatalogService(db);
    await db.insert((await import("../../db/schema/auth")).user).values({
      id: "u1",
      name: "u1",
      email: "u1@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await catalog.appendUserHistory(
      "u1",
      [
        {
          tmdbId: "42",
          mediaType: "movie",
          watchedAt: 100,
          sourceConnectionId: "trakt",
          episodeKey: null,
          progress: 1,
        },
      ],
      "trakt",
      100,
    );
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    const history = await provider.getHistory("u1");
    expect(history).toEqual([{ tmdbId: "42", mediaType: "movie", watchedAt: 100, progress: 1 }]);
    expect(fallback.getHistory).not.toHaveBeenCalled();
  });

  it("delegates watchlist and comments unchanged", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    expect(await provider.getWatchlist("u1")).toEqual([]);
    expect(await provider.getComments("u1")).toEqual([]);
    expect(fallback.getWatchlist).toHaveBeenCalledWith("u1");
    expect(fallback.getComments).toHaveBeenCalledWith("u1");
  });

  it("counts canonical hits, fallback misses, and unresolved misses", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([
      toCanonicalRow(
        { tmdbId: "550", type: "movie" },
        { ...FALLBACK_FEATURES, ids: { tmdb_id: "550" } },
      ),
    ]);
    const fallback = makeFallback({
      getItemFeatures: vi.fn(async (_userId, tmdbId) =>
        tmdbId === "1396" ? null : FALLBACK_FEATURES,
      ),
    });
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    await provider.getItemFeatures("u1", "550", "movie"); // canonical hit
    await provider.getItemFeatures("u1", "9999", "movie"); // miss + resolved by fallback
    await provider.getItemFeatures("u1", "1396", "movie"); // miss + unresolved

    const metrics = provider.consumeFeatureCacheMetrics();
    expect(metrics).toEqual({ hits: 1, misses: 2, unresolved: 1 });

    const drained = provider.consumeFeatureCacheMetrics();
    expect(drained).toEqual({ hits: 0, misses: 0, unresolved: 0 });
  });
});

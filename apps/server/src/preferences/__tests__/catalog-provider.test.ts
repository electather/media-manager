/* eslint-disable @typescript-eslint/unbound-method --
 * Tests assert on `vi.fn()` spies hung off a fallback record. The "unbound"
 * warning is noise — the spies are read as values, never invoked detached.
 */
import type { ArtworkBundle } from "@ent-mcp/shared/artwork";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const fetchArtworkBundleMock = vi
  .fn<(...args: unknown[]) => Promise<ArtworkBundle | null>>()
  .mockResolvedValue(null);
vi.mock("../../catalog/artwork-fetch", () => ({
  fetchArtworkBundle: (...args: unknown[]) => fetchArtworkBundleMock(...args),
  toArtworkIds: () => ({ tmdb: "0" }),
}));

const { cleanupInMemoryDbs, createInMemoryDb } =
  await import("../../__tests__/helpers/in-memory-db");
const { CatalogService } = await import("../../catalog/service");
const { toCanonicalRow } = await import("../../catalog/canonical");
const { CatalogPreferenceProvider } = await import("../catalog-provider");
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
  beforeEach(() => {
    // Default: artwork dispatch unavailable in this test env. Individual
    // bundle tests override the mock themselves.
    fetchArtworkBundleMock.mockReset().mockResolvedValue(null);
  });

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

  it("merges the artwork@v1 bundle into the cold-fill row (V46)", async () => {
    const bundle: ArtworkBundle = {
      poster: [{ url: "https://art/poster.jpg", language: "en" }],
      backdrop: [{ url: "https://art/backdrop.jpg", language: "00" }],
      clearLogo: [{ url: "https://art/logo.png", language: "en" }],
      thumb: [{ url: "https://art/thumb.jpg", language: "en" }],
    };
    fetchArtworkBundleMock.mockResolvedValueOnce(bundle);
    const catalog = new CatalogService(await createInMemoryDb());
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    await provider.getItemFeatures("u1", "550", "movie");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.posterUrl).toBe("https://art/poster.jpg");
    expect(persisted?.backdropUrl).toBe("https://art/backdrop.jpg");
    expect(persisted?.clearLogoUrl).toBe("https://art/logo.png");
    expect(persisted?.thumbUrl).toBe("https://art/thumb.jpg");
  });

  it("writes a metadata-only row when the artwork dispatch fails (V46 — degrade-quiet)", async () => {
    fetchArtworkBundleMock.mockResolvedValueOnce(null);
    const catalog = new CatalogService(await createInMemoryDb());
    const fallback = makeFallback();
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    const features = await provider.getItemFeatures("u1", "550", "movie");
    expect(features?.title).toBe("Fight Club");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persisted = await catalog.getMetadata("550", "movie");
    expect(persisted?.features?.director).toBe("David Fincher");
    expect(persisted?.posterUrl).toBeNull();
    expect(persisted?.clearLogoUrl).toBeNull();
  });

  it("dispatches the metadata fallback and artwork lookup in parallel (V46)", async () => {
    const order: string[] = [];
    fetchArtworkBundleMock.mockReset().mockImplementation(async () => {
      order.push("artwork:start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("artwork:end");
      return null;
    });
    const fallback = makeFallback({
      getItemFeatures: vi.fn(async () => {
        order.push("metadata:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("metadata:end");
        return FALLBACK_FEATURES;
      }),
    });
    const catalog = new CatalogService(await createInMemoryDb());
    const provider = new CatalogPreferenceProvider(catalog, fallback);

    await provider.getItemFeatures("u1", "550", "movie");

    expect(fetchArtworkBundleMock).toHaveBeenCalledOnce();
    // Both should start before either ends — parallel dispatch shape.
    expect(order.indexOf("metadata:start")).toBeLessThan(order.indexOf("artwork:end"));
    expect(order.indexOf("artwork:start")).toBeLessThan(order.indexOf("metadata:end"));
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
});

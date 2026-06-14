import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

import { CatalogService } from "../service";
import { selectMetadataBatch } from "../service/metadata-reads";
import type { CanonicalMetadata, MetadataKey } from "@nama/shared/catalog";

vi.mock("../service/metadata-reads");

function makeMeta(tmdbId: string, type: "movie" | "tv"): CanonicalMetadata {
  return {
    tmdbId,
    mediaType: type,
    title: `Title ${tmdbId}`,
    year: null,
    runtimeMinutes: null,
    posterUrl: `/${tmdbId}.jpg`,
    backdropUrl: null,
    clearLogoUrl: null,
    overview: null,
    originalLanguage: null,
    genres: null,
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
  };
}

/** Builds a service whose two underlying reads are stubbed; no DB is touched. */
function stubbedService(opts: {
  feed: MetadataKey[] | null;
  meta?: Record<string, CanonicalMetadata>;
}) {
  // The DB is never used because both reads are stubbed: getDiscoverFeed via a
  // method spy, and the batch metadata select via the mocked reads module.
  const catalog = new CatalogService({} as never);
  const getDiscoverFeed = vi.spyOn(catalog, "getDiscoverFeed").mockResolvedValue(opts.feed);
  vi.mocked(selectMetadataBatch).mockResolvedValue({ out: opts.meta ?? {}, accessed: [] });
  return { catalog, getDiscoverFeed };
}

describe("CatalogService.getTrendingMetadata", () => {
  it("returns [] when the day's snapshot is absent", async () => {
    const { catalog } = stubbedService({ feed: null });
    expect(await catalog.getTrendingMetadata(48)).toEqual([]);
  });

  it("reads the trending/popularity_desc feed for today", async () => {
    const { catalog, getDiscoverFeed } = stubbedService({ feed: [] });
    await catalog.getTrendingMetadata(48);
    expect(getDiscoverFeed).toHaveBeenCalledWith("trending", "popularity_desc", expect.any(Number));
  });

  it("slices the feed to the limit before fetching metadata", async () => {
    const feed: MetadataKey[] = [
      { tmdbId: "1", type: "movie" },
      { tmdbId: "2", type: "movie" },
      { tmdbId: "3", type: "tv" },
    ];
    const { catalog } = stubbedService({
      feed,
      meta: {
        "movie:1": makeMeta("1", "movie"),
        "movie:2": makeMeta("2", "movie"),
      },
    });
    const result = await catalog.getTrendingMetadata(2);
    // Slices to the limit, then reads the batch select directly — side-effect-free,
    // so the public pre-auth endpoint never records access under anonymous traffic
    // (getMetadataBatch, which getTrendingMetadata deliberately bypasses, would).
    expect(selectMetadataBatch).toHaveBeenCalledWith(expect.anything(), [
      { tmdbId: "1", type: "movie" },
      { tmdbId: "2", type: "movie" },
    ]);
    expect(result.map((m) => m.tmdbId)).toEqual(["1", "2"]);
  });

  it("preserves feed order and drops keys with no metadata row", async () => {
    const feed: MetadataKey[] = [
      { tmdbId: "10", type: "movie" },
      { tmdbId: "20", type: "tv" },
      { tmdbId: "30", type: "movie" },
    ];
    const { catalog } = stubbedService({
      feed,
      meta: {
        // `tv:20` intentionally absent to model a missing metadata row.
        "movie:30": makeMeta("30", "movie"),
        "movie:10": makeMeta("10", "movie"),
      },
    });
    const result = await catalog.getTrendingMetadata(48);
    expect(result.map((m) => `${m.mediaType}:${m.tmdbId}`)).toEqual(["movie:10", "movie:30"]);
  });
});

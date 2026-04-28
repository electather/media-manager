import { describe, expect, it, vi } from "vite-plus/test";
import { newReleasesFetcher } from "../rows/new-releases";
import type { RowFetchContext } from "../rows/index";
import type { CanonicalMetadata, MetadataKey } from "../../catalog/types";

function makeMediaServiceStub() {
  return {
    discoverFeed: vi.fn(async () => ({
      items: [
        {
          id: "movie:1",
          type: "movie",
          title: "Live Item 1",
          ids: { tmdb_id: "1" },
        },
      ],
      partial: false,
    })),
  };
}

function buildCanonical(key: MetadataKey, title: string): CanonicalMetadata {
  return {
    tmdbId: key.tmdbId,
    mediaType: key.type,
    title,
    year: 2024,
    runtimeMinutes: 100,
    posterUrl: null,
    backdropUrl: null,
    clearLogoUrl: null,
    overview: null,
    originalLanguage: "en",
    genres: ["Drama"],
    features: { keywords: [], cast: [], director: null, writers: [], creators: [] },
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
  };
}

function makeCtx(
  media: ReturnType<typeof makeMediaServiceStub>,
  catalog: {
    snapshot: MetadataKey[] | null;
    rows: Record<string, CanonicalMetadata>;
  },
): RowFetchContext {
  const getDiscoverFeed = vi.fn(async () => catalog.snapshot);
  const getMetadataBatch = vi.fn(async () => catalog.rows);
  return {
    userId: "u1",
    mediaService: media as unknown as RowFetchContext["mediaService"],
    catalogService: {
      getDiscoverFeed,
      getMetadataBatch,
    } as unknown as RowFetchContext["catalogService"],
    preferenceEngine: {} as RowFetchContext["preferenceEngine"],
    dataloader: {
      getStatusBatch: async () => ({}),
    } as unknown as RowFetchContext["dataloader"],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("newReleases fetcher catalog hydration", () => {
  it("falls back to the live discover plugin when the snapshot is missing", async () => {
    const media = makeMediaServiceStub();
    const ctx = makeCtx(media, { snapshot: null, rows: {} });

    const result = await newReleasesFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Live Item 1");
    expect(media.discoverFeed).toHaveBeenCalledOnce();
  });

  it("hydrates from the snapshot without calling the live plugin", async () => {
    const media = makeMediaServiceStub();
    const key: MetadataKey = { tmdbId: "550", type: "movie" };
    const ctx = makeCtx(media, {
      snapshot: [key],
      rows: { "movie:550": buildCanonical(key, "Cached Item") },
    });

    const result = await newReleasesFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Cached Item");
    expect(media.discoverFeed).not.toHaveBeenCalled();
  });

  it("flags partial when the metadata batch is missing rows", async () => {
    const media = makeMediaServiceStub();
    const present: MetadataKey = { tmdbId: "1", type: "movie" };
    const missing: MetadataKey = { tmdbId: "2", type: "movie" };
    const ctx = makeCtx(media, {
      snapshot: [present, missing],
      rows: { "movie:1": buildCanonical(present, "Hit") },
    });

    const result = await newReleasesFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.partial).toBe(true);
  });

  it("ends pagination cleanly when the snapshot is exhausted", async () => {
    const media = makeMediaServiceStub();
    const key: MetadataKey = { tmdbId: "1", type: "movie" };
    const ctx = makeCtx(media, {
      snapshot: [key],
      rows: { "movie:1": buildCanonical(key, "Item") },
    });

    const result = await newReleasesFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.cursor).toBeNull();
    expect(media.discoverFeed).not.toHaveBeenCalled();
  });

  it("emits an empty page with partial=true when every metadata batch row is cold", async () => {
    const media = makeMediaServiceStub();
    const key: MetadataKey = { tmdbId: "999", type: "movie" };
    const ctx = makeCtx(media, { snapshot: [key], rows: {} });

    const result = await newReleasesFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.cursor).toBeNull();
    expect(media.discoverFeed).not.toHaveBeenCalled();
  });
});

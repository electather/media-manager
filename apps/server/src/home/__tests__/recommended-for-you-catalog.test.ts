import { describe, expect, it, vi } from "vite-plus/test";
import { recommendedForYouFetcher } from "../rows/recommended-for-you";
import type { RowFetchContext } from "../rows/index";
import type {
  CanonicalMetadata,
  MetadataKey,
  RecItem,
  RecommendationList,
} from "../../catalog/types";
import { decodeCursor, encodeCursor } from "../cursor";

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
    thumbUrl: null,
    overview: null,
    originalLanguage: "en",
    genres: [],
    features: { keywords: [], cast: [], director: null, writers: [], creators: [] },
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
  };
}

interface RawMediaItemFixture {
  id: string;
  type: "movie" | "tv";
  title: string;
  ids: { tmdb_id: string };
}

function makeMediaServiceStub() {
  return {
    getRecommendationsFeed: vi.fn(
      async (): Promise<{ items: RawMediaItemFixture[]; partial: boolean }> => ({
        items: [],
        partial: false,
      }),
    ),
  };
}

function makeCtx(
  media: ReturnType<typeof makeMediaServiceStub>,
  catalog: {
    list: RecommendationList | null;
    rows: Record<string, CanonicalMetadata>;
  },
): RowFetchContext {
  return {
    userId: "u1",
    mediaService: media as unknown as RowFetchContext["mediaService"],
    catalogService: {
      getRecommendations: vi.fn(async () => catalog.list),
      getMetadataBatch: vi.fn(async () => catalog.rows),
    } as unknown as RowFetchContext["catalogService"],
    preferenceEngine: {
      rankCandidates: async () => [],
      explainRanked: async () => null,
    } as unknown as RowFetchContext["preferenceEngine"],
    dataloader: {
      getStatusBatch: async () => ({}),
    } as unknown as RowFetchContext["dataloader"],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("recommendedForYou catalog hydration", () => {
  it("falls back to the live recommendations feed when the catalog list is empty", async () => {
    const media = makeMediaServiceStub();
    const ctx = makeCtx(media, { list: null, rows: {} });

    await recommendedForYouFetcher.fetch(ctx, { cursor: null, limit: 20 });

    expect(media.getRecommendationsFeed).toHaveBeenCalledOnce();
  });

  it("hydrates from the catalog list and emits a v2 cursor with profile_version", async () => {
    const media = makeMediaServiceStub();
    const items: RecItem[] = Array.from({ length: 40 }, (_, i) => ({
      tmdbId: String(i),
      mediaType: "movie",
      matchReason: null,
      score: 1 - i / 100,
    }));
    const rows: Record<string, CanonicalMetadata> = {};
    for (const item of items) {
      rows[`movie:${item.tmdbId}`] = buildCanonical(
        { tmdbId: item.tmdbId, type: "movie" },
        `Item ${item.tmdbId}`,
      );
    }
    const ctx = makeCtx(media, {
      list: { items, profileVersion: 7, generatedAt: 1 },
      rows,
    });

    const result = await recommendedForYouFetcher.fetch(ctx, { cursor: null, limit: 20 });

    expect(media.getRecommendationsFeed).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(20);
    expect(result.cursor).not.toBeNull();
    const decoded = decodeCursor("recommendedForYou", result.cursor!);
    expect("pv" in decoded ? decoded.pv : null).toBe(7);
    expect(decoded.p).toBe(1);
  });

  it("resets the page when the cursor's profile_version is stale", async () => {
    const media = makeMediaServiceStub();
    const items: RecItem[] = Array.from({ length: 20 }, (_, i) => ({
      tmdbId: String(i),
      mediaType: "movie",
      matchReason: null,
      score: 1,
    }));
    const rows: Record<string, CanonicalMetadata> = {};
    for (const item of items) {
      rows[`movie:${item.tmdbId}`] = buildCanonical(
        { tmdbId: item.tmdbId, type: "movie" },
        `Item ${item.tmdbId}`,
      );
    }
    const ctx = makeCtx(media, {
      list: { items, profileVersion: 8, generatedAt: 1 },
      rows,
    });

    const stale = encodeCursor("recommendedForYou", {
      v: 1,
      r: "recommendedForYou",
      p: 5,
      pv: 7,
    });
    const result = await recommendedForYouFetcher.fetch(ctx, { cursor: stale, limit: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.id).toBe("movie:0");
  });

  it("starts at page 0 when a v2 catalog cursor arrives but the rec list is gone", async () => {
    // Regression: a stale v2 cursor (`{ p, pv }`) decoded by the live-path
    // reader used to carry its `p` counter forward, instantly tripping the
    // `MAX_ITEMS / opts.limit - 1` cap and emitting a null next-cursor —
    // pagination dead-ended on the page the user just loaded. Live path
    // must reset to `p = 0` when it sees a v2 cursor.
    const media = makeMediaServiceStub();
    const candidateItems: RawMediaItemFixture[] = Array.from({ length: 60 }, (_, i) => ({
      id: `movie:${i}`,
      type: "movie" as const,
      title: `Item ${i}`,
      ids: { tmdb_id: String(i) },
    }));
    media.getRecommendationsFeed = vi.fn(async () => ({ items: candidateItems, partial: false }));
    const ctx = makeCtx(media, { list: null, rows: {} });
    // Override the rank stub so the live path produces enough items to
    // emit a non-null next cursor — the real assertion is on `p` rolling
    // forward from 0, not on whether ranking produced output.
    ctx.preferenceEngine = {
      rankCandidates: async (_userId: string, candidates: unknown[]) =>
        (candidates as Array<unknown>).map((item) => ({
          item,
          score: 1,
          features: {},
          topContributors: [],
        })),
      explainRanked: async () => null,
    } as unknown as RowFetchContext["preferenceEngine"];
    const staleCursor = encodeCursor("recommendedForYou", {
      v: 1,
      r: "recommendedForYou",
      p: 5,
      pv: 3,
    });

    const result = await recommendedForYouFetcher.fetch(ctx, {
      cursor: staleCursor,
      limit: 20,
    });

    expect(media.getRecommendationsFeed).toHaveBeenCalledOnce();
    expect(result.cursor).not.toBeNull();
    const decoded = decodeCursor("recommendedForYou", result.cursor!);
    expect(decoded.p).toBe(1);
    expect("x" in decoded).toBe(true);
  });

  it("flags partial when the metadata batch is missing rows", async () => {
    const media = makeMediaServiceStub();
    const items: RecItem[] = [
      { tmdbId: "1", mediaType: "movie", matchReason: null, score: 1 },
      { tmdbId: "2", mediaType: "movie", matchReason: null, score: 1 },
    ];
    const ctx = makeCtx(media, {
      list: { items, profileVersion: 1, generatedAt: 1 },
      rows: {
        "movie:1": buildCanonical({ tmdbId: "1", type: "movie" }, "Hit"),
      },
    });

    const result = await recommendedForYouFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.partial).toBe(true);
  });
});

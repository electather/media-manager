import { describe, it, expect, vi } from "vite-plus/test";
import { type RowFetchContext } from "../rows/index";
import { trendingNowFetcher } from "../rows/trending-now";
import { continueWatchingFetcher } from "../rows/continue-watching";
import { newReleasesFetcher } from "../rows/new-releases";
import { yourWatchlistFetcher } from "../rows/your-watchlist";
import { upcomingForYouFetcher } from "../rows/upcoming-for-you";
import { becauseYouWatchedFetcher } from "../rows/because-you-watched";
import { recommendedForYouFetcher } from "../rows/recommended-for-you";
import { encodeCursor, decodeCursor } from "../cursor";

/**
 * Per-row contract tests covering the design's row-fetcher checklist:
 * happy path, dedupe, cursor roundtrip, MAX_ITEMS cap, partial-aggregate
 * propagation. Each fetcher gets its own focused suite — failures point
 * directly at the responsible row file.
 */

function makeMediaServiceStub(overrides: Partial<MediaServiceShape>): MediaServiceShape {
  return {
    getInProgress: vi.fn(async () => ({ items: [], partial: false })),
    getStatusBatch: vi.fn(async () => ({})),
    getWatchlistFeed: vi.fn(async () => ({ items: [], partial: false })),
    getUpcomingFeed: vi.fn(async () => ({ items: [], partial: false })),
    discoverFeed: vi.fn(async () => ({ items: [], partial: false })),
    getSimilarFeed: vi.fn(async () => ({ items: [], partial: false })),
    getTrendingFeed: vi.fn(async () => ({ items: [], partial: false })),
    getRecommendationsFeed: vi.fn(async () => ({ items: [], partial: false })),
    getDetails: vi.fn(async () => null),
    getWatchlist: vi.fn(async () => []),
    getUpcoming: vi.fn(async () => []),
    ...overrides,
  };
}

interface MediaServiceShape {
  getInProgress: (...args: unknown[]) => Promise<{ items: unknown[]; partial: boolean }>;
  getStatusBatch: (ids: string[]) => Promise<Record<string, string>>;
  getWatchlistFeed: () => Promise<{ items: unknown[]; partial: boolean }>;
  getUpcomingFeed: () => Promise<{ items: unknown[]; partial: boolean }>;
  discoverFeed: (...args: unknown[]) => Promise<{ items: unknown[]; partial: boolean }>;
  getSimilarFeed: (...args: unknown[]) => Promise<{ items: unknown[]; partial: boolean }>;
  getTrendingFeed: (...args: unknown[]) => Promise<{ items: unknown[]; partial: boolean }>;
  getRecommendationsFeed: (...args: unknown[]) => Promise<{ items: unknown[]; partial: boolean }>;
  getDetails: (id: string) => Promise<unknown>;
  getWatchlist: () => Promise<unknown[]>;
  getUpcoming: () => Promise<unknown[]>;
}

function makeCtx(media: MediaServiceShape): RowFetchContext {
  return {
    userId: "u1",
    mediaService: media as unknown as RowFetchContext["mediaService"],
    preferenceEngine: {
      rankCandidates: async (_userId: string, candidates: unknown[]) =>
        (candidates as Array<unknown>).map((item) => ({ item })),
      explainMatch: async () => null,
      explainRanked: async () => null,
    } as unknown as RowFetchContext["preferenceEngine"],
    dataloader: {
      getMetadata: async () => null,
      getStatusBatch: async (ids: string[]) => media.getStatusBatch(ids),
      getInProgressSet: async () => new Set<string>(),
      hasPlugin: async () => true,
    } as unknown as RowFetchContext["dataloader"],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

function rawItem(id: string, type: "movie" | "tv" = "movie"): unknown {
  const tmdbId = id.split(":")[1];
  return {
    id,
    title: `t-${id}`,
    type,
    ids: { tmdb_id: tmdbId },
  };
}

describe("continueWatching fetcher", () => {
  it("dedupes by composite id keeping the latest watch", async () => {
    const media = makeMediaServiceStub({
      getInProgress: vi.fn(async () => ({
        items: [
          {
            item: { id: "movie:1", title: "x", type: "movie", ids: { tmdb_id: "1" } },
            watchedMs: 100,
            durationMs: 1000,
            lastWatchedAt: "2026-01-01T00:00:00Z",
          },
          {
            item: { id: "movie:1", title: "x", type: "movie", ids: { tmdb_id: "1" } },
            watchedMs: 800,
            durationMs: 1000,
            lastWatchedAt: "2026-01-02T00:00:00Z",
          },
        ],
        partial: false,
      })),
    });
    const result = await continueWatchingFetcher.fetch(makeCtx(media), {
      cursor: null,
      limit: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.progress).toEqual({ watched: 800, total: 1000 });
  });

  it("omits progress when durationMs is zero", async () => {
    const media = makeMediaServiceStub({
      getInProgress: vi.fn(async () => ({
        items: [
          {
            item: { id: "movie:2", title: "x", type: "movie", ids: { tmdb_id: "2" } },
            watchedMs: 0,
            durationMs: 0,
            lastWatchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        partial: false,
      })),
    });
    const result = await continueWatchingFetcher.fetch(makeCtx(media), {
      cursor: null,
      limit: 20,
    });
    expect(result.items[0]?.progress).toBeUndefined();
  });

  it("propagates partial: true from MediaService", async () => {
    const media = makeMediaServiceStub({
      getInProgress: vi.fn(async () => ({
        items: [
          {
            item: { id: "movie:3", title: "x", type: "movie", ids: { tmdb_id: "3" } },
            watchedMs: 100,
            durationMs: 200,
            lastWatchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        partial: true,
      })),
    });
    const result = await continueWatchingFetcher.fetch(makeCtx(media), {
      cursor: null,
      limit: 20,
    });
    expect(result.partial).toBe(true);
  });
});

describe("trendingNow fetcher", () => {
  it("over-fetches based on cursor page so page 2 returns items", async () => {
    const items = Array.from({ length: 40 }, (_, i) => rawItem(`movie:${i}`));
    const media = makeMediaServiceStub({
      getTrendingFeed: vi.fn(async (...args: unknown[]) => {
        const { limit } = args[0] as { limit: number };
        return { items: items.slice(0, limit), partial: false };
      }),
    });
    const ctx = makeCtx(media);
    const cursor = encodeCursor("trendingNow", { v: 1, r: "trendingNow", p: 1 });
    const result = await trendingNowFetcher.fetch(ctx, { cursor, limit: 20 });
    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.id).toBe("movie:20");
  });
});

describe("newReleases fetcher", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function captureArg(spy: ReturnType<typeof vi.fn>) {
    return (
      spy.mock.calls[0] as unknown as [
        { releaseDateGte: number; releaseDateLte: number; sort: string },
      ]
    )[0];
  }

  it("passes a 91-day window (90 days back, exclusive end-of-day upper bound) and popularity_desc sort", async () => {
    const spy = vi.fn(async () => ({
      items: [rawItem("movie:1")],
      partial: false,
    }));
    const media = makeMediaServiceStub({ discoverFeed: spy });
    await newReleasesFetcher.fetch(makeCtx(media), { cursor: null, limit: 20 });
    expect(spy).toHaveBeenCalledOnce();
    const arg = captureArg(spy);
    expect(arg.releaseDateLte - arg.releaseDateGte).toBe(91 * DAY_MS);
    expect(arg.sort).toBe("popularity_desc");
  });

  it("uses today + DAY_MS as the upper bound so today's releases stay visible", async () => {
    // Bug regression: a previous implementation set the upper bound to
    // `Date.now()` which silently dropped any title released earlier today.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T15:30:00Z"));
    try {
      const spy = vi.fn(async () => ({ items: [], partial: false }));
      const media = makeMediaServiceStub({ discoverFeed: spy });
      await newReleasesFetcher.fetch(makeCtx(media), { cursor: null, limit: 20 });
      const arg = captureArg(spy);
      const today = Math.floor(Date.parse("2026-04-27T15:30:00Z") / DAY_MS) * DAY_MS;
      expect(arg.releaseDateLte).toBe(today + DAY_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("two calls within the same calendar day produce identical bounds (cache key stable)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:00:00Z"));
    try {
      const spy = vi.fn(async () => ({ items: [], partial: false }));
      const media = makeMediaServiceStub({ discoverFeed: spy });
      await newReleasesFetcher.fetch(makeCtx(media), { cursor: null, limit: 20 });
      const first = captureArg(spy);

      // Advance ten hours — still 2026-04-27 in UTC.
      vi.setSystemTime(new Date("2026-04-27T18:00:00Z"));
      await newReleasesFetcher.fetch(makeCtx(media), { cursor: null, limit: 20 });
      const second = (
        spy.mock.calls[1] as unknown as [{ releaseDateGte: number; releaseDateLte: number }]
      )[0];

      expect(second.releaseDateGte).toBe(first.releaseDateGte);
      expect(second.releaseDateLte).toBe(first.releaseDateLte);
    } finally {
      vi.useRealTimers();
    }
  });

  it("crossing UTC midnight rolls the bounds forward by a day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T23:30:00Z"));
    try {
      const spy = vi.fn(async () => ({ items: [], partial: false }));
      const media = makeMediaServiceStub({ discoverFeed: spy });
      await newReleasesFetcher.fetch(makeCtx(media), { cursor: null, limit: 20 });
      const before = captureArg(spy);

      vi.setSystemTime(new Date("2026-04-28T00:30:00Z"));
      await newReleasesFetcher.fetch(makeCtx(media), { cursor: null, limit: 20 });
      const after = (
        spy.mock.calls[1] as unknown as [{ releaseDateGte: number; releaseDateLte: number }]
      )[0];

      expect(after.releaseDateGte - before.releaseDateGte).toBe(DAY_MS);
      expect(after.releaseDateLte - before.releaseDateLte).toBe(DAY_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isEligible returns true unconditionally — metadata@v1 is host-assumed", async () => {
    const media = makeMediaServiceStub({});
    const ctx = makeCtx(media);
    expect(await newReleasesFetcher.isEligible("u1", ctx.dataloader, null)).toBe(true);
  });
});

describe("yourWatchlist fetcher", () => {
  it("sorts most-recently-added first", async () => {
    const media = makeMediaServiceStub({
      getWatchlistFeed: vi.fn(async () => ({
        items: [
          { item: rawItem("movie:1"), addedAt: "2026-01-01T00:00:00Z" },
          { item: rawItem("movie:2"), addedAt: "2026-02-01T00:00:00Z" },
        ],
        partial: false,
      })),
    });
    const result = await yourWatchlistFetcher.fetch(makeCtx(media), {
      cursor: null,
      limit: 20,
    });
    expect(result.items.map((i) => i.id)).toEqual(["movie:2", "movie:1"]);
  });
});

describe("upcomingForYou fetcher", () => {
  it("filters to currently in-progress shows only", async () => {
    const media = makeMediaServiceStub({
      getUpcomingFeed: vi.fn(async () => ({
        items: [
          { item: rawItem("tv:1", "tv"), airsAt: "2026-05-01T00:00:00Z" },
          { item: rawItem("tv:2", "tv"), airsAt: "2026-05-02T00:00:00Z" },
        ],
        partial: false,
      })),
    });
    const ctx = makeCtx(media);
    ctx.dataloader.getInProgressSet = async () => new Set(["tv:1"]);
    const result = await upcomingForYouFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items.map((i) => i.id)).toEqual(["tv:1"]);
  });

  it("emits a cursor anchored on (tmdbId, airsAt) when the page fills", async () => {
    const media = makeMediaServiceStub({
      getUpcomingFeed: vi.fn(async () => ({
        items: Array.from({ length: 30 }, (_, i) => ({
          item: rawItem(`tv:${i}`, "tv"),
          airsAt: `2026-05-${(i + 1).toString().padStart(2, "0")}T00:00:00Z`,
        })),
        partial: false,
      })),
    });
    const ctx = makeCtx(media);
    ctx.dataloader.getInProgressSet = async () =>
      new Set(Array.from({ length: 30 }, (_, i) => `tv:${i}`));
    const result = await upcomingForYouFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(20);
    expect(result.cursor).toBeTruthy();
    const decoded = decodeCursor("upcomingForYou", result.cursor!);
    expect(decoded.a).toMatch(/^tv:/);
  });
});

describe("becauseYouWatched fetcher", () => {
  it("requires a cursor — bare null returns empty without throwing", async () => {
    const media = makeMediaServiceStub({});
    const result = await becauseYouWatchedFetcher.fetch(makeCtx(media), {
      cursor: null,
      limit: 20,
    });
    expect(result.items).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  it("decodes seed from cursor.s and excludes in-progress items", async () => {
    const cursor = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: 1,
      s: "movie:550",
    });
    const media = makeMediaServiceStub({
      getSimilarFeed: vi.fn(async () => ({
        items: [rawItem("movie:1"), rawItem("movie:2")],
        partial: false,
      })),
    });
    const ctx = makeCtx(media);
    ctx.dataloader.getInProgressSet = async () => new Set(["movie:1"]);
    const result = await becauseYouWatchedFetcher.fetch(ctx, { cursor, limit: 20 });
    expect(result.items.map((i) => i.id)).toEqual(["movie:2"]);
  });

  it("isEligible returns false when the cursor seed no longer resolves", async () => {
    const cursor = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: 2,
      s: "movie:9999",
    });
    const ctx = makeCtx(makeMediaServiceStub({}));
    ctx.dataloader.getMetadata = async () => null;
    expect(await becauseYouWatchedFetcher.isEligible("u1", ctx.dataloader, cursor)).toBe(false);
  });

  it("isEligible returns true when the cursor seed still resolves", async () => {
    const cursor = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: 2,
      s: "movie:9999",
    });
    const ctx = makeCtx(makeMediaServiceStub({}));
    ctx.dataloader.getMetadata = async () => ({ id: "movie:9999", title: "Resolved" });
    expect(await becauseYouWatchedFetcher.isEligible("u1", ctx.dataloader, cursor)).toBe(true);
  });

  it("preserves cursor.s across pages", async () => {
    const cursor = encodeCursor("becauseYouWatched", {
      v: 1,
      r: "becauseYouWatched",
      p: 1,
      s: "movie:550",
    });
    expect(decodeCursor("becauseYouWatched", cursor).s).toBe("movie:550");
  });
});

describe("recommendedForYou fetcher", () => {
  it("over-fetches limit*3 candidates and runs PreferenceEngine", async () => {
    const items = Array.from({ length: 60 }, (_, i) => rawItem(`movie:${i}`));
    const spy = vi.fn(async () => ({ items, partial: false }));
    const media = makeMediaServiceStub({ getRecommendationsFeed: spy });
    const ctx = makeCtx(media);
    const result = await recommendedForYouFetcher.fetch(ctx, { cursor: null, limit: 20 });
    expect(spy).toHaveBeenCalledWith({ limit: 60 });
    expect(result.items).toHaveLength(20);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

// Stub the env so the transitively imported db/client doesn't trip over
// missing process env at module-load time.
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

import { HomeFeedService, resetHomeFeedServiceForTest } from "../index";
import { ROW_FETCHERS } from "../rows/index";
import * as signalsModule from "../signals";
import { MediaService } from "../../media/service";

/**
 * Integration tests for `HomeFeedService.getLayout` / `getRowContent`.
 *
 * The MediaService surface is mocked via `vi.spyOn` so the test runs without
 * any plugin runtime, DB, or HTTP. The signal snapshot is also stubbed so
 * each test fixture controls exactly which rows are eligible.
 */
describe("HomeFeedService", () => {
  let originalFetchers: Map<string, (typeof ROW_FETCHERS)[keyof typeof ROW_FETCHERS]["fetch"]>;

  beforeEach(() => {
    resetHomeFeedServiceForTest();
    originalFetchers = new Map(
      Object.entries(ROW_FETCHERS).map(([id, f]) => [id, f.fetch.bind(f)] as const),
    );
  });

  afterEach(() => {
    for (const [id, fetch] of originalFetchers) {
      (ROW_FETCHERS as Record<string, { fetch: typeof fetch }>)[id]!.fetch = fetch;
    }
    vi.restoreAllMocks();
  });

  it("returns rows: [] for a user with no plugins", async () => {
    stubSignals({
      hasWatchHistoryPlugin: false,
      hasRecommendationsPlugin: false,
      hasWatchlistPlugin: false,
      hasCalendarPlugin: false,
    });
    stubAllFetchersEmpty();
    const result = await new HomeFeedService().getLayout("user-no-plugins");
    expect(result.rows).toEqual([]);
    expect(result.hero).toBeNull();
  });

  it("renders only newReleases for a TMDB-only install", async () => {
    stubSignals({});
    stubAllFetchersEmpty();
    ROW_FETCHERS.newReleases.fetch = async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "Recent" }],
      cursor: null,
    });
    const result = await new HomeFeedService().getLayout("user-tmdb");
    expect(result.rows.map((r) => r.rowId)).toEqual(["newReleases"]);
  });

  it("orders rows correctly for a confident full install", async () => {
    stubSignals({
      hasWatchHistoryPlugin: true,
      hasRecommendationsPlugin: true,
      hasWatchlistPlugin: true,
      hasCalendarPlugin: true,
      inProgressCount: 3,
      watchlistCount: 5,
      calendarProgressCount: 2,
      profileConfidence: "high",
      recentSeed: {
        id: "movie:550",
        tmdbId: "550",
        mediaType: "movie",
        title: "Fight Club",
        reason: "liked",
      },
    });
    // Two items so the hero pick still leaves continueWatching non-empty.
    ROW_FETCHERS.continueWatching.fetch = async () => ({
      items: [
        { id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" },
        { id: "movie:11", tmdbId: "11", mediaType: "movie", title: "y" },
      ],
      cursor: null,
    });
    stubFetcherReturning("recommendedForYou", "movie:2");
    stubFetcherReturning("trendingNow", "movie:3");
    stubFetcherReturning("becauseYouWatched", "movie:4");
    stubFetcherReturning("yourWatchlist", "movie:5");
    stubFetcherReturning("newReleases", "movie:6");
    stubFetcherReturning("upcomingForYou", "tv:7");
    const result = await new HomeFeedService().getLayout("user-full");
    expect(result.rows.map((r) => r.rowId)).toEqual([
      "continueWatching",
      "recommendedForYou",
      "trendingNow",
      "becauseYouWatched",
      "yourWatchlist",
      "newReleases",
      "upcomingForYou",
    ]);
    expect(result.hero?.source).toBe("continueWatching");
  });

  it("retains upcomingForYou with items: [] when the fetch genuinely returns empty", async () => {
    stubSignals({
      hasCalendarPlugin: true,
      hasWatchHistoryPlugin: true,
      calendarProgressCount: 1,
    });
    stubAllFetchersEmpty();
    // upcomingForYou succeeds but with zero items — outcome=ok_empty.
    ROW_FETCHERS.upcomingForYou.fetch = async () => ({ items: [], cursor: null });
    const result = await new HomeFeedService().getLayout("user-caught-up");
    expect(result.rows.map((r) => r.rowId)).toContain("upcomingForYou");
    const row = result.rows.find((r) => r.rowId === "upcomingForYou");
    expect(row?.items).toEqual([]);
  });

  it("drops upcomingForYou when the fetcher times out", async () => {
    stubSignals({
      hasCalendarPlugin: true,
      hasWatchHistoryPlugin: true,
      calendarProgressCount: 1,
    });
    stubAllFetchersEmpty();
    vi.useFakeTimers();
    ROW_FETCHERS.upcomingForYou.fetch = () => new Promise(() => {});
    try {
      const promise = new HomeFeedService().getLayout("user-cal-timeout");
      // PER_ROW_TIMEOUT_MS bumped to 5s in #135 fix; advance past it so the
      // never-resolving fetcher hits the timeout sentinel and the row drops.
      await vi.advanceTimersByTimeAsync(5_001);
      const result = await promise;
      expect(result.rows.map((r) => r.rowId)).not.toContain("upcomingForYou");
    } finally {
      vi.useRealTimers();
    }
  });

  it("getRowContent returns home.row_unavailable when eligibility fails", async () => {
    vi.spyOn(MediaService.prototype, "hasCapabilityProvider").mockResolvedValue(false);
    const cursor = "anything";
    await expect(
      new HomeFeedService().getRowContent("u", { rowId: "continueWatching", cursor }),
    ).rejects.toMatchObject({ code: "home.row_unavailable" });
  });

  it("getRowContent returns home.bad_input for an unknown rowId", async () => {
    await expect(
      new HomeFeedService().getRowContent("u", {
        rowId: "doesNotExist" as never,
        cursor: "x",
      }),
    ).rejects.toMatchObject({ code: "home.bad_input" });
  });
});

function stubSignals(overrides: Partial<signalsModule.LayoutSignals>): void {
  vi.spyOn(signalsModule, "captureSignals").mockResolvedValue({
    hasWatchHistoryPlugin: false,
    hasWatchlistPlugin: false,
    hasCalendarPlugin: false,
    hasRecommendationsPlugin: false,
    inProgressCount: 0,
    watchlistCount: 0,
    calendarProgressCount: 0,
    profileConfidence: "none",
    recentSeed: null,
    ...overrides,
  });
}

function stubAllFetchersEmpty(): void {
  for (const fetcher of Object.values(ROW_FETCHERS)) {
    fetcher.fetch = async () => ({ items: [], cursor: null });
  }
}

function stubFetcherReturning(rowId: keyof typeof ROW_FETCHERS, itemId: string): void {
  ROW_FETCHERS[rowId].fetch = async () => {
    const [mediaType, tmdbId] = itemId.split(":") as ["movie" | "tv", string];
    return {
      items: [{ id: itemId, tmdbId, mediaType, title: itemId }],
      cursor: null,
    };
  };
}

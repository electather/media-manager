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
 *
 * `getLayout` now returns row stubs (no items). Item loading moved to
 * `getRowContent`. Tests verify row structure and hero resolution only.
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

  it("returns trendingNow and newReleases stubs for a fresh install with no plugins", async () => {
    stubSignals({
      hasWatchHistoryPlugin: false,
      hasRecommendationsPlugin: false,
      hasWatchlistPlugin: false,
      hasCalendarPlugin: false,
    });
    stubAllFetchersEmpty();
    const result = await new HomeFeedService().getLayout("user-no-plugins");
    // Stubs are built from signals; trendingNow and newReleases are always eligible.
    expect(result.rows.map((r) => r.rowId)).toEqual(["trendingNow", "newReleases"]);
    expect(result.hero).toBeNull();
  });

  it("returns stubs for trendingNow and newReleases for a TMDB-only install", async () => {
    stubSignals({});
    stubAllFetchersEmpty();
    const result = await new HomeFeedService().getLayout("user-tmdb");
    expect(result.rows.map((r) => r.rowId)).toContain("trendingNow");
    expect(result.rows.map((r) => r.rowId)).toContain("newReleases");
  });

  it("orders stubs correctly for a confident full install", async () => {
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
    // Hero fetch only needs continueWatching. Return a non-null cursor so the
    // stub is retained after hero exclusion.
    ROW_FETCHERS.continueWatching.fetch = async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" }],
      cursor: "cursor-after-hero",
    });
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

  it("stamps titleOverride and initialCursor on the hero source stub", async () => {
    stubSignals({
      hasWatchHistoryPlugin: true,
      inProgressCount: 2,
    });
    ROW_FETCHERS.continueWatching.fetch = async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" }],
      cursor: "cursor-after-hero",
    });
    const result = await new HomeFeedService().getLayout("user-hero");
    const stub = result.rows.find((r) => r.rowId === "continueWatching");
    expect(stub?.initialCursor).toBe("cursor-after-hero");
    expect(stub?.titleOverride).toBe("Also watching");
    expect(result.hero?.source).toBe("continueWatching");
  });

  it("drops the hero source stub when the hero fetch cursor is null (only one item)", async () => {
    stubSignals({
      hasWatchHistoryPlugin: true,
      inProgressCount: 1,
    });
    ROW_FETCHERS.continueWatching.fetch = async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" }],
      cursor: null, // only one item — hero consumed it
    });
    const result = await new HomeFeedService().getLayout("user-solo-hero");
    expect(result.rows.map((r) => r.rowId)).not.toContain("continueWatching");
    expect(result.hero?.source).toBe("continueWatching");
  });

  it("includes upcomingForYou stub when calendar signals are present", async () => {
    stubSignals({
      hasCalendarPlugin: true,
      hasWatchHistoryPlugin: true,
      calendarProgressCount: 1,
    });
    stubAllFetchersEmpty();
    const result = await new HomeFeedService().getLayout("user-caught-up");
    expect(result.rows.map((r) => r.rowId)).toContain("upcomingForYou");
    // Stubs have no items field; items are loaded lazily via getRowContent.
    expect("items" in (result.rows.find((r) => r.rowId === "upcomingForYou") ?? {})).toBe(false);
  });

  it("sets becauseYouWatched subtitle from the recent seed title", async () => {
    stubSignals({
      recentSeed: {
        id: "tv:1396",
        tmdbId: "1396",
        mediaType: "tv",
        title: "Breaking Bad",
        reason: "high_rating",
      },
    });
    stubAllFetchersEmpty();
    const result = await new HomeFeedService().getLayout("user-seed");
    const stub = result.rows.find((r) => r.rowId === "becauseYouWatched");
    expect(stub?.subtitle).toBe("Because you watched Breaking Bad");
  });

  it("getRowContent returns home.row_unavailable when eligibility fails", async () => {
    vi.spyOn(MediaService.prototype, "hasCapabilityProvider").mockResolvedValue(false);
    await expect(
      new HomeFeedService().getRowContent("u", { rowId: "continueWatching", cursor: null }),
    ).rejects.toMatchObject({ code: "home.row_unavailable" });
  });

  it("getRowContent returns home.bad_input for an unknown rowId", async () => {
    await expect(
      new HomeFeedService().getRowContent("u", {
        rowId: "doesNotExist" as never,
        cursor: null,
      }),
    ).rejects.toMatchObject({ code: "home.bad_input" });
  });

  it("getRowContent accepts a null cursor and treats it as first page", async () => {
    vi.spyOn(MediaService.prototype, "hasCapabilityProvider").mockResolvedValue(true);
    ROW_FETCHERS.trendingNow.fetch = async (_ctx, opts) => {
      expect(opts.cursor).toBeNull();
      return {
        items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" }],
        cursor: null,
      };
    };
    const result = await new HomeFeedService().getRowContent("u", {
      rowId: "trendingNow",
      cursor: null,
    });
    expect(result.items).toHaveLength(1);
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

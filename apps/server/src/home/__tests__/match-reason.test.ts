import { describe, expect, it } from "vite-plus/test";
import { mapTopContributor, pickMatchReason } from "../match-reason";
import type { InternalCompactMediaItem, RowContext } from "../types";

function ctx(overrides: Partial<RowContext> = {}): RowContext {
  return {
    userId: "u1",
    mediaService: {} as unknown as RowContext["mediaService"],
    catalog: {} as unknown as RowContext["catalog"],
    statusBatch: {} as unknown as RowContext["statusBatch"],
    logger: {} as unknown as RowContext["logger"],
    ...overrides,
  };
}

function item(overrides: Partial<InternalCompactMediaItem> = {}): InternalCompactMediaItem {
  return {
    id: "movie:1",
    tmdbId: "1",
    mediaType: "movie",
    title: "Test",
    ...overrides,
  };
}

describe("pickMatchReason", () => {
  it("returns finishing_soon when continueWatching-active progress >= 0.85", () => {
    const r = pickMatchReason(
      "continueWatching-active",
      item({ progress: { watched: 90, total: 100 } }),
      ctx(),
    );
    expect(r).toEqual({ key: "finishing_soon", params: {} });
  });

  it("returns matches_recent_picks for active items below the threshold", () => {
    const r = pickMatchReason(
      "continueWatching-active",
      item({ progress: { watched: 10, total: 100 } }),
      ctx({ recentPickCount: 7 }),
    );
    expect(r).toEqual({ key: "matches_recent_picks", params: { n: "7" } });
  });

  it("returns from_active_series for nextUpFromServer items", () => {
    const r = pickMatchReason(
      "continueWatching-next",
      item({
        seriesContext: { season: 1, episode: 2, episodeTitle: "E", nextUpFromServer: true },
      }),
      ctx(),
    );
    expect(r).toEqual({ key: "from_active_series", params: {} });
  });

  it("returns continuing_series for non-server-stitched next items", () => {
    const r = pickMatchReason("continueWatching-next", item(), ctx());
    expect(r).toEqual({ key: "continuing_series", params: {} });
  });

  it("returns similar_to_seed with the seedTitle param", () => {
    const r = pickMatchReason("becauseYouWatched", item(), ctx({ seedTitle: "Heat" }));
    expect(r).toEqual({ key: "similar_to_seed", params: { seedTitle: "Heat" } });
  });

  it("returns from_genre_you_love for recommendedForYou-* with a genre top contributor", () => {
    const r = pickMatchReason(
      "recommendedForYou-tv",
      item({ __topContributors: [{ category: "genre", value: "Drama", weight: 0.4 }] }),
      ctx(),
    );
    expect(r).toEqual({ key: "from_genre_you_love", params: { genre: "Drama" } });
  });

  it("falls back to highly_rated when topContributors is empty", () => {
    const r = pickMatchReason("recommendedForYou-movies", item(), ctx());
    expect(r).toEqual({ key: "highly_rated", params: {} });
  });

  it("returns null for trendingNow + newReleases", () => {
    expect(pickMatchReason("trendingNow", item(), ctx())).toBeNull();
    expect(pickMatchReason("newReleases", item(), ctx())).toBeNull();
  });

  it("returns upcoming_release for upcomingForYou", () => {
    const r = pickMatchReason("upcomingForYou", item(), ctx());
    expect(r).toEqual({ key: "upcoming_release", params: {} });
  });

  it("returns recently_added for yourWatchlist when __addedAtMs is within 7 days", () => {
    const recent = item({ __addedAtMs: Date.now() - 1000 });
    expect(pickMatchReason("yourWatchlist", recent, ctx())).toEqual({
      key: "recently_added",
      params: {},
    });
  });

  it("returns because_in_watchlist for yourWatchlist when __addedAtMs is older than 7 days", () => {
    const stale = item({ __addedAtMs: Date.now() - 10 * 24 * 60 * 60 * 1000 });
    expect(pickMatchReason("yourWatchlist", stale, ctx())).toEqual({
      key: "because_in_watchlist",
      params: {},
    });
  });

  it("returns because_in_watchlist for yourWatchlist when __addedAtMs is missing", () => {
    expect(pickMatchReason("yourWatchlist", item(), ctx())).toEqual({
      key: "because_in_watchlist",
      params: {},
    });
  });
});

describe("mapTopContributor", () => {
  it("returns from_genre_you_love for genre", () => {
    expect(mapTopContributor([{ category: "genre", value: "Drama", weight: 1 }])).toEqual({
      key: "from_genre_you_love",
      params: { genre: "Drama" },
    });
  });

  it("returns matches_recent_picks for non-genre categories", () => {
    expect(
      mapTopContributor([
        { category: "person", value: "Lena Marsh", weight: 1 },
        { category: "decade", value: "2020s", weight: 0.5 },
      ]),
    ).toEqual({ key: "matches_recent_picks", params: { n: "2" } });
  });

  it("returns highly_rated when contributors are empty", () => {
    expect(mapTopContributor([])).toEqual({ key: "highly_rated", params: {} });
  });
});

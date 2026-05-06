import { describe, expect, it } from "vite-plus/test";
import { HERO_REASONS, MATCH_REASON_KEYS, ROW_KINDS, type MatchReasonKey } from "../enums";

describe("home enums — MATCH_REASON_KEYS", () => {
  it("ships exactly 10 keys", () => {
    expect(MATCH_REASON_KEYS).toHaveLength(10);
  });

  it("includes every key the resolver branches over", () => {
    const expected: MatchReasonKey[] = [
      "matches_recent_picks",
      "from_genre_you_love",
      "similar_to_seed",
      "because_in_watchlist",
      "continuing_series",
      "upcoming_release",
      "recently_added",
      "highly_rated",
      "from_active_series",
      "finishing_soon",
    ];
    for (const key of expected) {
      expect(MATCH_REASON_KEYS).toContain(key);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(MATCH_REASON_KEYS).size).toBe(MATCH_REASON_KEYS.length);
  });
});

describe("home enums — ROW_KINDS + HERO_REASONS", () => {
  it("ships every row kind referenced by the row registry slugs", () => {
    expect(ROW_KINDS).toContain("continueWatching");
    expect(ROW_KINDS).toContain("recommendedForYou");
    expect(ROW_KINDS).toContain("trendingNow");
    expect(ROW_KINDS).toContain("newReleases");
    expect(ROW_KINDS).toContain("becauseYouWatched");
    expect(ROW_KINDS).toContain("upcomingForYou");
    expect(ROW_KINDS).toContain("yourWatchlist");
  });

  it("hero reasons cover the cascade sources", () => {
    expect(HERO_REASONS).toEqual(["continue_watching", "recommended", "trending", "new_release"]);
  });
});

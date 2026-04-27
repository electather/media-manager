import { describe, it, expect } from "vite-plus/test";
import {
  candidateRows,
  makeHero,
  orderRows,
  resolveHeroCandidates,
  resolveLayoutOrder,
  type FetchedRow,
} from "../rules";
import type { LayoutSignals } from "../signals";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

const baseSignals: LayoutSignals = {
  hasWatchHistoryPlugin: false,
  hasWatchlistPlugin: false,
  hasCalendarPlugin: false,
  hasRecommendationsPlugin: false,
  inProgressCount: 0,
  watchlistCount: 0,
  calendarProgressCount: 0,
  profileConfidence: "none",
  recentSeed: null,
};

function withSignals(overrides: Partial<LayoutSignals>): LayoutSignals {
  return { ...baseSignals, ...overrides };
}

const sampleItem: CompactMediaItem = {
  id: "movie:550",
  tmdbId: "550",
  mediaType: "movie",
  title: "Fight Club",
};

/**
 * `candidateRows` and `orderRows` are pure: every test runs in microseconds
 * with synthetic signals. Snapshot covers the v1 rule set so future
 * changes show up as a single diff rather than a hunt across cases.
 */
describe("home rules", () => {
  describe("candidateRows", () => {
    it("returns only TMDB-only rows for a fresh install", () => {
      expect(candidateRows(baseSignals)).toEqual(["trendingNow", "newReleases"]);
    });

    it("includes continueWatching only when watch-history plugin AND items present", () => {
      expect(
        candidateRows(withSignals({ hasWatchHistoryPlugin: true, inProgressCount: 0 })),
      ).not.toContain("continueWatching");
      expect(
        candidateRows(withSignals({ hasWatchHistoryPlugin: true, inProgressCount: 3 })),
      ).toContain("continueWatching");
    });

    it("requires both calendar plugin AND non-zero count for upcomingForYou", () => {
      expect(
        candidateRows(withSignals({ hasCalendarPlugin: true, calendarProgressCount: 0 })),
      ).not.toContain("upcomingForYou");
      expect(
        candidateRows(withSignals({ hasCalendarPlugin: true, calendarProgressCount: 2 })),
      ).toContain("upcomingForYou");
    });

    it("includes becauseYouWatched only when a seed is present", () => {
      expect(candidateRows(baseSignals)).not.toContain("becauseYouWatched");
      expect(
        candidateRows(
          withSignals({
            recentSeed: {
              id: "movie:550",
              tmdbId: "550",
              mediaType: "movie",
              title: "Fight Club",
              reason: "liked",
            },
          }),
        ),
      ).toContain("becauseYouWatched");
    });
  });

  describe("orderRows", () => {
    it("places continueWatching first when present", () => {
      const order = orderRows(["trendingNow", "continueWatching"], baseSignals);
      expect(order[0]).toBe("continueWatching");
    });

    it("puts trending before recommended when profile confidence is low", () => {
      const order = orderRows(
        ["recommendedForYou", "trendingNow"],
        withSignals({ profileConfidence: "low" }),
      );
      expect(order).toEqual(["trendingNow", "recommendedForYou"]);
    });

    it("puts recommended before trending when profile confidence is medium/high", () => {
      const high = orderRows(
        ["recommendedForYou", "trendingNow"],
        withSignals({ profileConfidence: "high" }),
      );
      expect(high).toEqual(["recommendedForYou", "trendingNow"]);
      const medium = orderRows(
        ["recommendedForYou", "trendingNow"],
        withSignals({ profileConfidence: "medium" }),
      );
      expect(medium).toEqual(["recommendedForYou", "trendingNow"]);
    });

    it("treats absent confidence as low", () => {
      const order = orderRows(
        ["recommendedForYou", "trendingNow"],
        withSignals({ profileConfidence: "none" }),
      );
      expect(order).toEqual(["trendingNow", "recommendedForYou"]);
    });

    it("preserves the static tail order yourWatchlist → newReleases → upcomingForYou", () => {
      const order = orderRows(["upcomingForYou", "yourWatchlist", "newReleases"], baseSignals);
      expect(order).toEqual(["yourWatchlist", "newReleases", "upcomingForYou"]);
    });
  });

  describe("resolveLayoutOrder", () => {
    it("composes candidate filtering and ordering for a representative full install", () => {
      const signals = withSignals({
        hasWatchHistoryPlugin: true,
        hasWatchlistPlugin: true,
        hasCalendarPlugin: true,
        hasRecommendationsPlugin: true,
        inProgressCount: 4,
        watchlistCount: 12,
        calendarProgressCount: 3,
        profileConfidence: "high",
        recentSeed: {
          id: "tv:1396",
          tmdbId: "1396",
          mediaType: "tv",
          title: "Breaking Bad",
          reason: "high_rating",
        },
      });
      expect(resolveLayoutOrder(signals)).toEqual([
        "continueWatching",
        "recommendedForYou",
        "trendingNow",
        "becauseYouWatched",
        "yourWatchlist",
        "newReleases",
        "upcomingForYou",
      ]);
    });
  });

  describe("resolveHeroCandidates", () => {
    it("returns empty when no hero-eligible rows are in order", () => {
      expect(resolveHeroCandidates(baseSignals, ["newReleases", "yourWatchlist"])).toEqual([]);
    });

    it("includes trendingNow when present", () => {
      expect(resolveHeroCandidates(baseSignals, ["trendingNow", "newReleases"])).toContain(
        "trendingNow",
      );
    });

    it("excludes recommendedForYou when profile confidence is low/none", () => {
      const order: FetchedRow["rowId"][] = ["recommendedForYou", "trendingNow"];
      const candidates = resolveHeroCandidates(withSignals({ profileConfidence: "low" }), order);
      expect(candidates).not.toContain("recommendedForYou");
      expect(candidates).toContain("trendingNow");
    });

    it("includes recommendedForYou when profile confidence is medium or high", () => {
      const order: FetchedRow["rowId"][] = ["continueWatching", "recommendedForYou", "trendingNow"];
      const medium = resolveHeroCandidates(withSignals({ profileConfidence: "medium" }), order);
      expect(medium).toContain("recommendedForYou");
      const high = resolveHeroCandidates(withSignals({ profileConfidence: "high" }), order);
      expect(high).toContain("recommendedForYou");
    });

    it("returns candidates in priority order: continueWatching, rfy, trending", () => {
      const order: FetchedRow["rowId"][] = ["continueWatching", "recommendedForYou", "trendingNow"];
      const candidates = resolveHeroCandidates(withSignals({ profileConfidence: "high" }), order);
      expect(candidates).toEqual(["continueWatching", "recommendedForYou", "trendingNow"]);
    });
  });

  describe("makeHero", () => {
    it("builds a LayoutHero with resumeUrl null", () => {
      const hero = makeHero(sampleItem, "trendingNow", "trending");
      expect(hero).toEqual({
        item: sampleItem,
        source: "trendingNow",
        reason: "trending",
        resumeUrl: null,
      });
    });
  });
});

import { describe, it, expect } from "vite-plus/test";
import {
  applyHeroExclusion,
  candidateRows,
  dropEmpty,
  orderRows,
  resolveHero,
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

function fetched(
  rowId: FetchedRow["rowId"],
  items: CompactMediaItem[],
  outcome: FetchedRow["outcome"] = "ok_items",
): FetchedRow {
  return { rowId, title: rowId, items, cursor: null, outcome };
}

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

  describe("resolveHero", () => {
    const map = (rows: FetchedRow[]) => new Map(rows.map((r) => [r.rowId, r] as const));

    it("picks the first continueWatching item when present", () => {
      const hero = resolveHero(baseSignals, map([fetched("continueWatching", [sampleItem])]));
      expect(hero?.source).toBe("continueWatching");
      expect(hero?.reason).toBe("continue_watching");
    });

    it("falls through to RFY only when profile confidence is medium/high", () => {
      const lowSignals = withSignals({ profileConfidence: "low" });
      const lowHero = resolveHero(lowSignals, map([fetched("recommendedForYou", [sampleItem])]));
      expect(lowHero).toBeNull();

      const highSignals = withSignals({ profileConfidence: "high" });
      const highHero = resolveHero(highSignals, map([fetched("recommendedForYou", [sampleItem])]));
      expect(highHero?.source).toBe("recommendedForYou");
    });

    it("falls through to trending when neither continueWatching nor confident RFY exists", () => {
      const hero = resolveHero(
        baseSignals,
        map([fetched("recommendedForYou", []), fetched("trendingNow", [sampleItem])]),
      );
      expect(hero?.source).toBe("trendingNow");
    });

    it("returns null when every contender is empty", () => {
      const hero = resolveHero(baseSignals, map([fetched("trendingNow", [])]));
      expect(hero).toBeNull();
    });
  });

  describe("applyHeroExclusion", () => {
    it("removes the hero item from its source row and stamps the override title", () => {
      const second = { ...sampleItem, id: "tv:9999" };
      const rows = [fetched("continueWatching", [sampleItem, second])];
      const hero = resolveHero(baseSignals, new Map([["continueWatching", rows[0]!]]));
      const out = applyHeroExclusion(rows, hero);
      expect(out[0]?.items).toEqual([second]);
      expect(out[0]?.titleOverride).toBe("Also watching");
    });

    it("filters by id, not by reference", () => {
      const ref = { ...sampleItem };
      const dup = { ...sampleItem };
      const rows = [fetched("trendingNow", [ref, dup])];
      const hero = resolveHero(baseSignals, new Map([["trendingNow", rows[0]!]]));
      const out = applyHeroExclusion(rows, hero);
      // Both ref and dup share id; both are removed.
      expect(out[0]?.items).toHaveLength(0);
    });

    it("is a no-op when the hero source is not in the row set", () => {
      const rows = [fetched("trendingNow", [sampleItem])];
      const hero = {
        item: sampleItem,
        source: "continueWatching" as const,
        reason: "continue_watching" as const,
        resumeUrl: null,
      };
      expect(applyHeroExclusion(rows, hero)).toEqual(rows);
    });
  });

  describe("dropEmpty", () => {
    it("drops empty rows except an upcomingForYou ok_empty", () => {
      const rows: FetchedRow[] = [
        fetched("trendingNow", []),
        fetched("upcomingForYou", [], "ok_empty"),
        fetched("newReleases", [sampleItem]),
      ];
      expect(dropEmpty(rows).map((r) => r.rowId)).toEqual(["upcomingForYou", "newReleases"]);
    });

    it("does not exempt upcomingForYou when the outcome was a timeout", () => {
      const rows: FetchedRow[] = [fetched("upcomingForYou", [], "timeout")];
      expect(dropEmpty(rows)).toHaveLength(0);
    });

    it("does not exempt upcomingForYou when the outcome was partial-empty", () => {
      const rows: FetchedRow[] = [fetched("upcomingForYou", [], "partial")];
      expect(dropEmpty(rows)).toHaveLength(0);
    });
  });
});

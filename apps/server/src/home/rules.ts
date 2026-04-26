import type { CompactMediaItem, LayoutHero, RowKind } from "@ent-mcp/shared/home";
import type { LayoutSignals } from "./signals";

/**
 * Pure functions over the layout signal snapshot. Tested in isolation; no
 * I/O. Variants are mechanical swaps — A/B testing the rule table never
 * touches the fetch layer.
 *
 * Per V9: nothing in this file may read the database, dispatch a plugin
 * call, or otherwise observe state outside its arguments.
 */

export const ROW_TITLES: Record<RowKind, string> = {
  continueWatching: "Continue Watching",
  recommendedForYou: "Recommended for You",
  trendingNow: "Trending Now",
  newReleases: "New Releases",
  becauseYouWatched: "Because You Watched",
  upcomingForYou: "Upcoming for You",
  yourWatchlist: "Your Watchlist",
};

/**
 * Title swap applied when a row supplied the hero. Signals "this is the
 * same row, minus the headline pick" to the dashboard. Only the rows that
 * can ever supply a hero appear here.
 */
export const TITLE_OVERRIDE_MAP: Partial<Record<RowKind, string>> = {
  continueWatching: "Also watching",
  recommendedForYou: "More for you",
  trendingNow: "More trending",
};

/** Filters the v1 catalog by plugin availability and cheap-signal gates. */
export function candidateRows(signals: LayoutSignals): RowKind[] {
  const out: RowKind[] = [];
  if (signals.hasWatchHistoryPlugin && signals.inProgressCount > 0) {
    out.push("continueWatching");
  }
  if (signals.hasRecommendationsPlugin) out.push("recommendedForYou");
  out.push("trendingNow");
  out.push("newReleases");
  if (signals.recentSeed) out.push("becauseYouWatched");
  if (signals.hasWatchlistPlugin && signals.watchlistCount > 0) {
    out.push("yourWatchlist");
  }
  if (signals.hasCalendarPlugin && signals.calendarProgressCount > 0) {
    out.push("upcomingForYou");
  }
  return out;
}

/**
 * Orders the candidate row set. Continue Watching is always first when
 * present; Recommended-vs-Trending swap depends on whether the user has a
 * confident profile; Because-You-Watched sits next to the recommendation
 * pair; tail rows hold a fixed order.
 */
export function orderRows(candidates: RowKind[], signals: LayoutSignals): RowKind[] {
  const set = new Set(candidates);
  const order: RowKind[] = [];
  if (set.has("continueWatching")) order.push("continueWatching");

  const rfyBeforeTrending =
    signals.profileConfidence === "medium" || signals.profileConfidence === "high";
  const rfyPair: RowKind[] = rfyBeforeTrending
    ? ["recommendedForYou", "trendingNow"]
    : ["trendingNow", "recommendedForYou"];
  for (const r of rfyPair) if (set.has(r)) order.push(r);

  if (set.has("becauseYouWatched")) order.push("becauseYouWatched");

  for (const r of ["yourWatchlist", "newReleases", "upcomingForYou"] as const) {
    if (set.has(r)) order.push(r);
  }
  return order;
}

/** Convenience composition used by `HomeFeedService`. Pure. */
export function resolveLayoutOrder(signals: LayoutSignals): RowKind[] {
  return orderRows(candidateRows(signals), signals);
}

/**
 * Internal shape passed between fetch and rules in the layout pipeline.
 * Fields after `partial`/`outcome` are populated by `runFetch`; `rowId` and
 * `items` come from the registry + fetcher result.
 */
export type FetchOutcome = "ok_items" | "ok_empty" | "partial" | "timeout" | "all_failed";

export interface FetchedRow {
  rowId: RowKind;
  title: string;
  subtitle?: string;
  items: CompactMediaItem[];
  cursor: string | null;
  outcome: FetchOutcome;
  partial?: true;
  titleOverride?: string;
}

/**
 * Picks at most one hero across the populated row set. Continue Watching
 * wins when present; otherwise Recommended For You is allowed only when the
 * user's profile is confident (avoids "you'll love this" headlines built
 * from a single feedback event); Trending takes anything else; null when
 * every contender is empty.
 */
export function resolveHero(
  signals: LayoutSignals,
  rowResults: Map<RowKind, FetchedRow>,
): LayoutHero | null {
  const cw = rowResults.get("continueWatching");
  if (cw && cw.items.length > 0) {
    return makeHero(cw.items[0]!, "continueWatching", "continue_watching");
  }

  const confident = signals.profileConfidence === "medium" || signals.profileConfidence === "high";
  const rfy = rowResults.get("recommendedForYou");
  if (rfy && rfy.items.length > 0 && confident) {
    return makeHero(rfy.items[0]!, "recommendedForYou", "recommended");
  }

  const trending = rowResults.get("trendingNow");
  if (trending && trending.items.length > 0) {
    return makeHero(trending.items[0]!, "trendingNow", "trending");
  }
  return null;
}

function makeHero(
  item: CompactMediaItem,
  source: RowKind,
  reason: LayoutHero["reason"],
): LayoutHero {
  return {
    item,
    source,
    reason,
    // `resumeUrl` resolution is deferred to the orchestrator — it depends on
    // which plugin supplied the progress. The pure-function rule layer can
    // always emit `null`; a richer implementation lives one layer up.
    resumeUrl: null,
  };
}

/**
 * Removes the hero item from its source row and stamps the matching title
 * override. Runs before `dropEmpty` so a row that was a single-item hero
 * candidate disappears when the hero is taken from it.
 */
export function applyHeroExclusion(rows: FetchedRow[], hero: LayoutHero | null): FetchedRow[] {
  if (!hero) return rows;
  return rows.map((row) => {
    if (row.rowId !== hero.source) return row;
    const filtered = row.items.filter((i) => i.id !== hero.item.id);
    return {
      ...row,
      items: filtered,
      titleOverride: TITLE_OVERRIDE_MAP[row.rowId],
    };
  });
}

/**
 * Drops rows whose `items` array is empty after fetch + hero exclusion.
 * `upcomingForYou` is exempt only when the fetch itself genuinely returned
 * no items (`outcome === "ok_empty"`); a timeout or aggregate failure is
 * treated like any other row and dropped — the design's "you're caught up"
 * empty-state copy must not render during a calendar plugin outage.
 */
export function dropEmpty(rows: FetchedRow[]): FetchedRow[] {
  return rows.filter(
    (r) => r.items.length > 0 || (r.rowId === "upcomingForYou" && r.outcome === "ok_empty"),
  );
}

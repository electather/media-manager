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
}

export function makeHero(
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

const HERO_REASONS: Partial<Record<RowKind, LayoutHero["reason"]>> = {
  continueWatching: "continue_watching",
  recommendedForYou: "recommended",
  trendingNow: "trending",
};

/**
 * Returns the subset of hero-eligible rows present in `order`, in priority
 * order: continueWatching wins; recommendedForYou only when profile is
 * confident; trendingNow is the last resort. Drives which rows `fetchHero`
 * tries before giving up.
 */
export function resolveHeroCandidates(signals: LayoutSignals, order: RowKind[]): RowKind[] {
  const inOrder = new Set(order);
  const out: RowKind[] = [];
  if (inOrder.has("continueWatching")) out.push("continueWatching");
  const confident = signals.profileConfidence === "medium" || signals.profileConfidence === "high";
  if (inOrder.has("recommendedForYou") && confident) out.push("recommendedForYou");
  if (inOrder.has("trendingNow")) out.push("trendingNow");
  return out;
}

export { HERO_REASONS };

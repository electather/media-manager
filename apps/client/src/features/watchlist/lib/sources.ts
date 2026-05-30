import { defineMediaSource } from "@/shared/media/source";
import type { MoodId } from "@ent-mcp/shared/watchlist";
import {
  watchlistItemsParams,
  watchlistMoodItemsParams,
  type WatchlistItemsKeyOpts,
  type WatchlistItemsParams,
  type WatchlistMoodItemsParams,
} from "./query-keys";

/**
 * The watchlist `ClientMediaSource`s (design §B3). Each list the watchlist
 * reads is declared once here and flows through the shared `defineMediaSource`
 * fetcher (`GET /api/media/sources/:sourceId`), replacing `lib/fetchers.ts`
 * (#509). All four are watchlist-origin sources, so a bad cursor falls to the
 * first page (`cursorOnNull: "firstPage"`), matching the resolver's per-source
 * policy.
 *
 * The default recently-added strip size; the old `fetchRecently` capped the
 * section at five rows so the strip stays a strip.
 */
const RECENTLY_LIMIT = 5;

/** The unfiltered + filtered all-items list (sort / bucket / mood ride the params). */
export function watchlistItemsSource(opts: WatchlistItemsKeyOpts = {}) {
  return defineMediaSource<WatchlistItemsParams>({
    sourceId: "watchlist-items",
    params: watchlistItemsParams(opts),
    mode: "infinite",
    cursorOnNull: "firstPage",
  });
}

/** A single mood cluster (mosaic preview at limit 3, mood page at limit 60). */
export function watchlistMoodItemsSource(moodId: MoodId, limit?: number) {
  return defineMediaSource<WatchlistMoodItemsParams>({
    sourceId: "watchlist-mood-items",
    params: watchlistMoodItemsParams(moodId, limit),
    mode: "infinite",
    cursorOnNull: "firstPage",
  });
}

/**
 * Tonight's watchable candidate pool. The resolver returns the FLAT enriched
 * candidate page (cursor `null`); the hero/alternate ranking + split now runs
 * client-side over these candidates (design §B3, see `lib/tonight-pick.ts`).
 */
export function watchlistTonightSource() {
  return defineMediaSource<Record<string, never>>({
    sourceId: "watchlist-tonight",
    params: {},
    mode: "section",
    cursorOnNull: "firstPage",
  });
}

/** The recently-added strip — a bounded section, no pagination. */
export function watchlistRecentlySource(limit: number = RECENTLY_LIMIT) {
  return defineMediaSource<{ limit: number }>({
    sourceId: "watchlist-recently",
    params: { limit },
    mode: "section",
    cursorOnNull: "firstPage",
  });
}

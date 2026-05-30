import type { MoodId, WatchlistBucket, WatchlistSort } from "@ent-mcp/shared/watchlist";
import { mediaKeys } from "@/shared/media/query-keys";

export interface WatchlistItemsKeyOpts {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/** Wire params for the `watchlist-items` media source (and thus its query key). */
export interface WatchlistItemsParams {
  sort: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * The single source of truth for the `watchlist-items` request params. Both the
 * `ClientMediaSource` descriptor (`lib/sources.ts`) and the query-key factory
 * derive from this, so the optimistic-mutation cache key
 * (`mediaKeys.source("watchlist-items", { sort: "recent" })`) and the list
 * hook's key can never drift. `sort` always defaults to `recent`; `bucket` /
 * `mood` are only present when set, matching the old `watchlistKeys.items` shape.
 */
export function watchlistItemsParams(opts: WatchlistItemsKeyOpts = {}): WatchlistItemsParams {
  const params: WatchlistItemsParams = { sort: opts.sort ?? "recent" };
  if (opts.bucket) params.bucket = opts.bucket;
  if (opts.mood) params.mood = opts.mood;
  return params;
}

/** Wire params for the `watchlist-mood-items` media source. */
export interface WatchlistMoodItemsParams {
  moodId: MoodId;
  limit?: number;
}

export function watchlistMoodItemsParams(moodId: MoodId, limit?: number): WatchlistMoodItemsParams {
  return limit != null ? { moodId, limit } : { moodId };
}

/**
 * Watchlist query-key factory, now DERIVED from `mediaKeys` (design §B3,
 * invariant V.CL1) — the standalone `["watchlist", …]` root is gone. Every key
 * resolves to a `mediaKeys.source(...)` (or the shared counts/moods key) so a
 * single `invalidateQueries({ queryKey: mediaKeys.root })` after a mutation
 * sweeps the whole surface once (#505), and the section error boundaries reset
 * the exact caches the list hooks read.
 *
 * `moodItems(moodId)` intentionally omits `limit` so a retry resets both the
 * mosaic preview (limit 3) and the mood-page (limit 60) caches via React
 * Query's partial key match, mirroring the old prefix-reset behaviour.
 */
export const watchlistKeys = {
  root: mediaKeys.root,
  counts: mediaKeys.counts,
  moods: mediaKeys.moods,
  tonight: () => mediaKeys.source("watchlist-tonight", {}),
  recently: () => mediaKeys.source("watchlist-recently", {}),
  moodItems: (moodId: MoodId) => mediaKeys.source("watchlist-mood-items", { moodId }),
  items: (opts: WatchlistItemsKeyOpts = {}) =>
    mediaKeys.source("watchlist-items", { ...watchlistItemsParams(opts) }),
} as const;

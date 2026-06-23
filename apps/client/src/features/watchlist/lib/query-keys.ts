import type { MoodId, WatchlistBucket, WatchlistSort } from "@nama/shared/watchlist";
import { mediaKeys } from "@/shared/media/query-keys";

export interface WatchlistItemsKeyOpts {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * Wire params for the `watchlist-items` media source (and thus its query key).
 * A `type` (not `interface`) so it carries the implicit index signature that
 * `defineMediaSource`'s flat-param constraint requires.
 */
export type WatchlistItemsParams = {
  sort: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
};

/**
 * Single source of truth for `watchlist-items` params. Both `ClientMediaSource` (lib/sources.ts)
 * and query-key factory derive from this so cache keys never drift. Defaults `sort: "recent"`;
 * `bucket`/`mood` only when set.
 */
export function watchlistItemsParams(opts: WatchlistItemsKeyOpts = {}): WatchlistItemsParams {
  const params: WatchlistItemsParams = { sort: opts.sort ?? "recent" };
  if (opts.bucket) params.bucket = opts.bucket;
  if (opts.mood) params.mood = opts.mood;
  return params;
}

/** Wire params for the `watchlist-mood-items` media source (a `type` for the
 * same flat-param-constraint reason as {@link WatchlistItemsParams}). */
export type WatchlistMoodItemsParams = {
  moodId: MoodId;
  limit?: number;
};

export function watchlistMoodItemsParams(moodId: MoodId, limit?: number): WatchlistMoodItemsParams {
  return limit != null ? { moodId, limit } : { moodId };
}

/**
 * DERIVED from `mediaKeys` (design §B3, V.CL1) — no standalone `["watchlist", …]` root.
 * Each key resolves to `mediaKeys.source(...)` so one `invalidateQueries({ queryKey: mediaKeys.root })`
 * sweeps the whole surface (#505). `moodItems(moodId)` omits `limit` to reset partial-key caches.
 */
export const watchlistKeys = {
  root: mediaKeys.root,
  moods: mediaKeys.moods,
  tonight: () => mediaKeys.source("watchlist-tonight", {}),
  recently: () => mediaKeys.source("watchlist-recently", {}),
  moodItems: (moodId: MoodId) => mediaKeys.source("watchlist-mood-items", { moodId }),
  items: (opts: WatchlistItemsKeyOpts = {}) =>
    mediaKeys.source("watchlist-items", { ...watchlistItemsParams(opts) }),
} as const;

import { MEDIA_ROW_BUCKETS, type MediaRowBucket } from "../media/enums";

export const WATCHLIST_STATES = ["active", "removed"] as const;
export type WatchlistState = (typeof WATCHLIST_STATES)[number];

export const WATCHLIST_SOURCES = [
  "manual",
  "plugin",
  "search",
  "notification",
  "recommended",
  "trending",
] as const;
export type WatchlistSource = (typeof WATCHLIST_SOURCES)[number];

/** Sources a user may set via the public API. Excludes server-internal `plugin`. */
export const WATCHLIST_USER_SOURCES = [
  "manual",
  "search",
  "notification",
  "recommended",
  "trending",
] as const;
export type WatchlistUserSource = (typeof WATCHLIST_USER_SOURCES)[number];

/**
 * Coarse buckets the list endpoint can pre-classify against. Media owns the
 * tuple because home and watchlist rows share the same enrichment signals.
 * `in-progress` is a real bucket; rows whose underlying media has an active
 * watch position (from `continueWatching@v1`) win over `ready`. `unavailable`
 * is the catch-all visible bucket for rows that have no server copy and no
 * active request status — the classifier emits no hidden tail.
 */
export const WATCHLIST_BUCKETS = MEDIA_ROW_BUCKETS;
export type WatchlistBucket = MediaRowBucket;

/** Sort variants supported by `/api/watchlist/items`. `recent` is the default and uses keyset cursors. */
export const WATCHLIST_SORTS = ["recent", "alpha", "runtime", "status"] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];

/** Mood ids derived server-side from `(row, metadata)` predicates. */
export const MOOD_IDS = [
  "cozy",
  "epic",
  "cerebral",
  "dark",
  "laugh",
  "throwback",
  "quick",
  "binge",
] as const;
export type MoodId = (typeof MOOD_IDS)[number];

/** Minimum tally for a mood cluster to surface in the summary. */
export const MIN_CLUSTER_SIZE = 3 as const;

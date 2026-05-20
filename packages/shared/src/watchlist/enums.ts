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
 * Coarse buckets the list endpoint can pre-classify against so the server
 * skips artwork hydration for rows the requested filter would drop.
 * `in-progress` is folded into `ready` server-side (matches client header).
 */
export const WATCHLIST_LIST_FILTERS = ["ready", "awaiting", "upcoming"] as const;
export type WatchlistListFilter = (typeof WATCHLIST_LIST_FILTERS)[number];

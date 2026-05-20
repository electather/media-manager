export const WATCHLIST_STATES = ["active", "removed"] as const;
export type WatchlistState = (typeof WATCHLIST_STATES)[number];

export const WATCHLIST_SOURCES = [
  "manual",
  "plugin",
  "import",
  "search",
  "notification",
  "recommended",
  "trending",
] as const;
export type WatchlistSource = (typeof WATCHLIST_SOURCES)[number];

/** Sources a user may set via the public API. Excludes server-internal `plugin`. */
export const WATCHLIST_USER_SOURCES = [
  "manual",
  "import",
  "search",
  "notification",
  "recommended",
  "trending",
] as const;
export type WatchlistUserSource = (typeof WATCHLIST_USER_SOURCES)[number];

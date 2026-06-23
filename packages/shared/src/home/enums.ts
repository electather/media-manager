/** Row kinds for v1 home feed. Tuple is source of truth; Zod reuses it directly
 * (adding a kind forces sync in both places). Wire `rowId` is opaque slug; registry
 * can ship multiple rows per kind (e.g. recommendedForYou-tv and -movies share kind). */
export const ROW_KINDS = [
  "continueWatching",
  "recommendedForYou",
  "trendingNow",
  "newReleases",
  "becauseYouWatched",
  "upcomingForYou",
  "yourWatchlist",
  "similarTo",
] as const;

export type RowKind = (typeof ROW_KINDS)[number];

/** Reasons a hero entry was selected. Drives copy on the dashboard. */
export const HERO_REASONS = [
  "continue_watching",
  "recommended",
  "trending",
  "new_release",
] as const;

export type HeroReason = (typeof HERO_REASONS)[number];

/**
 * Typed match-reason keys used by `CompactMediaItem.matchReason`. The client
 * resolves each key to localised copy via Paraglide; `params` carries ICU
 * placeholders so e.g. `from_genre_you_love` can render the genre name.
 */
export const MATCH_REASON_KEYS = [
  "matches_recent_picks",
  "from_genre_you_love",
  "similar_to_seed",
  "because_in_watchlist",
  "continuing_series",
  "upcoming_release",
  "recently_added",
  "highly_rated",
  "from_active_series",
  "finishing_soon",
] as const;

export type MatchReasonKey = (typeof MATCH_REASON_KEYS)[number];

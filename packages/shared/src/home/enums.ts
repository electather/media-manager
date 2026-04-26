/**
 * Row kinds shipped in v1 of the home feed. The tuple is the source of truth:
 * Zod inputs use `z.enum(ROW_KINDS)` and the derived `RowKind` union mirrors
 * it exactly so adding a row in one place forces it in the other.
 */
export const ROW_KINDS = [
  "continueWatching",
  "recommendedForYou",
  "trendingNow",
  "newReleases",
  "becauseYouWatched",
  "upcomingForYou",
  "yourWatchlist",
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

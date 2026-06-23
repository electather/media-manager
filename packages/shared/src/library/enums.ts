/**
 * Five viewing lenses: each is a different grouping/sort of the same filtered
 * set (design `docs/2026-06-02-library-backend-design.md` §The 5 lenses).
 * Order = tab order; `az` = index lens.
 */
export const LIBRARY_LENSES = ["az", "timeline", "collections", "server", "quality"] as const;
export type LibraryLens = (typeof LIBRARY_LENSES)[number];

/**
 * Watched-progress buckets derived server-side from a title's watch position.
 * `partial` is a title with progress on some but not all of its parts; the
 * facet and the `watched` filter axis both key off this tuple.
 */
export const WATCHED_STATES = ["watched", "partial", "unwatched"] as const;
export type WatchedState = (typeof WATCHED_STATES)[number];

/**
 * Canonical quality tiers (descending fidelity) anchor the `rankQualityTier` heuristic.
 * Plugin `qualityTiers` are free-form; unlisted labels rank below all here.
 * Keep hi→lo: higher index = lower fidelity.
 */
export const QUALITY_TIERS = [
  "4K HDR",
  "4K",
  "HDR",
  "Dolby Vision",
  "1080p",
  "720p",
  "SD",
] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

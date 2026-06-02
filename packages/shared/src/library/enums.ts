/**
 * The five viewing "lenses" the library page slices its owned collection
 * through. Each lens is a different grouping/sort of the same filtered owned
 * set (design `docs/2026-06-02-library-backend-design.md` §The 5 lenses). The
 * order is the tab order; `az` is the index lens.
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
 * Canonical quality tiers in descending fidelity. This tuple is only the
 * anchor for the `rankQualityTier` heuristic that orders the Quality lens; the
 * actual `qualityTiers` strings come from plugins and are free-form
 * (`"4K HDR"`, `"Atmos"`, `"1080p"`, etc.), so any label not found here ranks
 * below every listed tier. Keep this hi→lo: a higher index is lower fidelity.
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

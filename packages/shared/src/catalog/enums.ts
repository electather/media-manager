/**
 * Catalog domain enum constants. Exported as `as const` tuples so Drizzle's
 * `text("x", { enum: ... })` and Zod's `z.enum(...)` both accept them and
 * derive identical string-literal types.
 */

export const DISCOVER_FEED_KINDS = ["newReleases", "trending", "upcoming", "popular"] as const;
export type DiscoverFeedKind = (typeof DISCOVER_FEED_KINDS)[number];

export const DISCOVER_SORTS = ["popularity_desc", "release_date_asc"] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

export const RECOMMENDATION_LIST_KINDS = ["default"] as const;
export type RecommendationListKind = (typeof RECOMMENDATION_LIST_KINDS)[number];

// Contribution categories from preference engine; mirrors FeatureCategory (genres/keywords/people/decades/runtimes/languages)
// collapsed to user-facing home feed match-reason terms ("from genre you love", etc.).
export const TOP_CONTRIBUTOR_CATEGORIES = [
  "genre",
  "person",
  "keyword",
  "decade",
  "language",
  "runtime",
] as const;

export type TopContributorCategory = (typeof TOP_CONTRIBUTOR_CATEGORIES)[number];

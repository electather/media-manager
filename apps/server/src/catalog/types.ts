import type { MediaType } from "@ent-mcp/shared/media";

export const DISCOVER_FEED_KINDS = ["newReleases", "trending", "upcoming", "popular"] as const;
export type DiscoverFeedKind = (typeof DISCOVER_FEED_KINDS)[number];

export const DISCOVER_SORTS = ["popularity_desc", "release_date_asc"] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

export const RECOMMENDATION_LIST_KINDS = ["default"] as const;
export type RecommendationListKind = (typeof RECOMMENDATION_LIST_KINDS)[number];

export interface MetadataKey {
  tmdbId: string;
  type: MediaType;
}

export interface CanonicalMetadata {
  tmdbId: string;
  mediaType: MediaType;
  title: string;
  year: number | null;
  runtimeMinutes: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  clearLogoUrl: string | null;
  overview: string | null;
  originalLanguage: string | null;
  genres: string[] | null;
  features: CanonicalFeatures | null;
  lastRefreshedAt: number;
  lastAccessedAt: number;
  createdAt: number;
}

/**
 * Scoring-only projection persisted on `canonical_metadata.features`.
 * Display fields (title, year, runtime, genres, originalLanguage) live on
 * their own columns; this blob carries the fields the preference engine
 * needs to derive feature contributions. `getItemFeatures` reconstitutes a
 * PE `CandidateFeatures` by merging row columns with this blob.
 */
export interface CanonicalFeatures {
  keywords: string[];
  cast: string[];
  director: string | null;
  writers: string[];
  creators: string[];
}

export interface IdMap {
  tmdbId: string;
  mediaType: MediaType;
  imdbId: string | null;
  tvdbId: string | null;
  traktId: string | null;
  traktSlug: string | null;
}

export interface CanonicalMetadataWithIds extends CanonicalMetadata {
  ids: IdMap | null;
}

/**
 * Categories the preference engine attributes a contribution to. Mirrors the
 * `FeatureCategory` shape (genres/keywords/people/decades/runtimes/languages)
 * collapsed to the user-facing terms the home feed surfaces in match-reason
 * copy ("from genre you love", "matches recent picks", …).
 */
export const TOP_CONTRIBUTOR_CATEGORIES = [
  "genre",
  "person",
  "keyword",
  "decade",
  "language",
  "runtime",
] as const;

export type TopContributorCategory = (typeof TOP_CONTRIBUTOR_CATEGORIES)[number];

/**
 * Frozen snapshot of the strongest signal that pushed a candidate into the
 * rec list. The home feed orchestrator maps the leading entry to a typed
 * `MatchReason` so the chip copy survives without re-running scoring.
 */
export interface TopContributor {
  category: TopContributorCategory;
  /** Human-readable feature value (e.g. `"Drama"`, `"Lena Marsh"`, `"2020s"`). */
  value: string;
  /** Already-ranked weight; the first entry is the strongest. */
  weight: number;
}

export interface RecItem {
  tmdbId: string;
  mediaType: MediaType;
  matchReason: string | null;
  /**
   * Top three feature contributions captured at rec-list build time. The
   * home feed reads `[0]` to derive a typed match-reason chip; the field is
   * an empty array on rows persisted before the snapshot landed (rec-build
   * job rerun fills them; orchestrator falls back to "highly_rated" until).
   */
  topContributors: TopContributor[];
  score: number;
}

export interface RecommendationList {
  items: RecItem[];
  profileVersion: number;
  generatedAt: number;
}

export interface HistoryEvent {
  tmdbId: string;
  mediaType: MediaType;
  watchedAt: number;
  sourceConnectionId: string;
  episodeKey: string | null;
  progress: number | null;
}

export interface RatingEvent {
  tmdbId: string;
  mediaType: MediaType;
  rating: number;
  ratedAt: number;
  sourceConnectionId: string;
}

export type PluginCursors = Record<string, number>;

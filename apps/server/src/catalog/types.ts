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
  thumbUrl: string | null;
  overview: string | null;
  originalLanguage: string | null;
  genres: string[] | null;
  features: CanonicalFeatures | null;
  lastRefreshedAt: number;
  lastAccessedAt: number;
  createdAt: number;
}

export interface CanonicalFeatures {
  keywords: string[];
  people: string[];
  decades: string[];
  runtimeBucket: string | null;
  language: string | null;
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

export interface RecItem {
  tmdbId: string;
  mediaType: MediaType;
  matchReason: string | null;
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

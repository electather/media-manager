import type { MediaType } from "@ent-mcp/shared/media";
import type { DiscoverFeedKind, DiscoverSort, RecommendationListKind } from "../db/schema/catalog";

export type { DiscoverFeedKind, DiscoverSort, RecommendationListKind };

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

import type { MediaItem } from "../media/types";

export type ProfileMediaType = "movie" | "tv" | "combined";
export type FeedbackAction = "like" | "dislike" | "rate" | "note";
export type Confidence = "low" | "medium" | "high";

export type FeatureCategory =
  | "genres"
  | "keywords"
  | "people"
  | "decades"
  | "runtimes"
  | "languages";

export type WeightMap = Record<string, number>;

export interface ProfileFeatures {
  genres: WeightMap;
  keywords: WeightMap;
  people: WeightMap;
  decades: WeightMap;
  runtimes: WeightMap;
  languages: WeightMap;
}

export interface PreferenceProfile {
  userId: string;
  mediaType: ProfileMediaType;
  features: ProfileFeatures;
  sampleSize: number;
  confidence: Confidence;
  lastRebuiltAt: number;
  lastUpdatedAt: number;
  embedding?: number[];
}

export interface FeatureContribution {
  category: FeatureCategory;
  feature: string;
  weight: number;
}

export interface RankedCandidate {
  item: MediaItem;
  score: number;
  profileScore: number;
  confidence: Confidence;
  topContributors: FeatureContribution[];
}

export interface RebuildResult {
  userId: string;
  mediaType: ProfileMediaType;
  sampleSize: number;
  confidence: Confidence;
}

export interface UpdateResult {
  userId: string;
  applied: number;
}

export interface UserItemFeedback {
  rated?: number;
  liked?: boolean;
  noted?: boolean;
  latestAt?: number;
}

/**
 * The denormalized shape the feature extractors read. Callers should map
 * whatever metadata they have — plugin MediaItem or the richer MediaDetails —
 * into this before invoking extraction.
 */
export interface CandidateFeatures {
  id: string;
  type: "movie" | "tv";
  title?: string;
  year?: number | null;
  runtime?: number | null;
  genres?: string[];
  keywords?: string[];
  cast?: string[];
  director?: string | null;
  writers?: string[];
  creators?: string[];
  originalLanguage?: string | null;
}

export interface FeedbackRecord {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  action: FeedbackAction;
  rating: number | null;
  note: string | null;
  noteSentiment: "positive" | "negative" | "neutral" | null;
  noteKeywords: string[] | null;
  createdAt: number;
}

/** Score dictionary projection for the six categories. */
export function emptyFeatures(): ProfileFeatures {
  return { genres: {}, keywords: {}, people: {}, decades: {}, runtimes: {}, languages: {} };
}

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  "genres",
  "keywords",
  "people",
  "decades",
  "runtimes",
  "languages",
];

export const CATEGORY_WEIGHTS: Record<FeatureCategory, number> = {
  genres: 0.3,
  keywords: 0.3,
  people: 0.15,
  decades: 0.1,
  runtimes: 0.05,
  languages: 0.1,
};

export const CONFIDENCE_THRESHOLDS = { low: 15, medium: 50 } as const;

export function deriveConfidence(sampleSize: number): Confidence {
  if (sampleSize < CONFIDENCE_THRESHOLDS.low) return "low";
  if (sampleSize < CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "high";
}

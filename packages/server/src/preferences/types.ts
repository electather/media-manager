import type { Confidence, FeatureCategory, ProfileFeatures } from "@ent-mcp/shared/preferences";
import type { MediaItem } from "@ent-mcp/shared/media";

// ─── Server-only scoring and feature-extraction types ─────────────────────────

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

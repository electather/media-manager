import type { Confidence, FeatureCategory, ProfileFeatures } from "@ent-mcp/shared/preferences";

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

/** Score dictionary projection for the six categories. */
export function emptyFeatures(): ProfileFeatures {
  return { genres: {}, keywords: {}, people: {}, decades: {}, runtimes: {}, languages: {} };
}

export function deriveConfidence(sampleSize: number): Confidence {
  if (sampleSize < CONFIDENCE_THRESHOLDS.low) return "low";
  if (sampleSize < CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "high";
}

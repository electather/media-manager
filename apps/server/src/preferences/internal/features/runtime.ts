import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../constants";

export type RuntimeBucket = "short" | "medium" | "long" | "very_long";

/** Classifies runtime in minutes into the bucket used in the profile. */
export function runtimeBucketFor(minutes: number): RuntimeBucket {
  if (minutes < 40) return "short";
  if (minutes < 100) return "medium";
  if (minutes < 150) return "long";
  return "very_long";
}

export const runtimeScorer: FeatureScorer = {
  id: "runtimes",
  categoryWeight: CATEGORY_WEIGHTS.runtimes,
  extract(item) {
    if (typeof item.runtime !== "number" || item.runtime <= 0) return {};
    return { [runtimeBucketFor(item.runtime)]: 1 };
  },
};

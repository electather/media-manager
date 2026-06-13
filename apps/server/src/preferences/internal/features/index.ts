import type { FeatureCategory, PreferenceProfile, WeightMap } from "@nama/shared/preferences";
import type { CandidateFeatures } from "../../types";
import { genresScorer } from "./genres";
import { keywordsScorer } from "./keywords";
import { peopleScorer } from "./people";
import { decadesScorer } from "./decades";
import { runtimeScorer } from "./runtime";
import { languagesScorer } from "./languages";

export interface FeatureScorer {
  id: FeatureCategory;
  /** Fallback weight when overridden profile weights are absent. */
  categoryWeight: number;
  /**
   * Feature-dictionary scorers return a `value -> weight` dict from the item.
   * Embedding-style scorers omit this and implement `scoreCandidate` instead.
   */
  extract?(item: CandidateFeatures): WeightMap;
  scoreCandidate?(candidate: CandidateFeatures, profile: PreferenceProfile): number;
}

/**
 * Registration order matches the profile feature categories. An
 * `embeddingScorer` slot is reserved at the tail — a future `embedding@v1`
 * plugin appends here without disturbing the existing pipeline.
 */
export const SCORERS: readonly FeatureScorer[] = Object.freeze([
  genresScorer,
  keywordsScorer,
  peopleScorer,
  decadesScorer,
  runtimeScorer,
  languagesScorer,
]);

export function isDictScorer(
  scorer: FeatureScorer,
): scorer is FeatureScorer & { extract: NonNullable<FeatureScorer["extract"]> } {
  return typeof scorer.extract === "function";
}

export {
  genresScorer,
  keywordsScorer,
  peopleScorer,
  decadesScorer,
  runtimeScorer,
  languagesScorer,
};

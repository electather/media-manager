import { orderBy } from "es-toolkit/array";
import type { MediaItem } from "@ent-mcp/shared/media";
import type {
  Confidence,
  FeatureCategory,
  PreferenceProfile,
  ProfileFeatures,
} from "@ent-mcp/shared/preferences";
import { SCORERS, isDictScorer, type FeatureScorer } from "./features";
import {
  CATEGORY_WEIGHTS,
  CONFIDENCE_THRESHOLDS,
  type CandidateFeatures,
  type FeatureContribution,
  type RankedCandidate,
} from "./types";

const DEFAULT_ALPHA = 0.7;
const MIN_ALPHA = 0.3;
const TOP_CONTRIBUTORS = 3;

export interface ScoringOptions {
  alpha?: number;
}

export interface CandidateScore {
  index: number;
  profileScore: number;
  contributors: FeatureContribution[];
}

/**
 * Extracts the candidate's per-category feature dictionaries. Uses the same
 * extractors as the rebuild so rank-time and rebuild-time feature views stay
 * in lockstep.
 */
export function extractFeatureDicts(
  item: CandidateFeatures,
): Record<FeatureCategory, Record<string, number>> {
  const out = {} as Record<FeatureCategory, Record<string, number>>;
  for (const scorer of SCORERS) {
    out[scorer.id] = isDictScorer(scorer) ? scorer.extract(item) : {};
  }
  return out;
}

/**
 * Returns unnormalized profile score plus the per-feature contributions that
 * composed it. Contributors are `categoryWeight * profileWeight` — i.e. their
 * final contribution to the blended profile score — and are already sorted
 * descending.
 */
export function scoreCandidate(
  candidate: CandidateFeatures,
  profile: PreferenceProfile,
): { profileScore: number; contributors: FeatureContribution[] } {
  const dicts = extractFeatureDicts(candidate);
  let total = 0;
  const contributors: FeatureContribution[] = [];
  for (const scorer of SCORERS) {
    const profileMap = profile.features[scorer.id];
    const itemMap = dicts[scorer.id] ?? {};
    for (const feature of Object.keys(itemMap)) {
      const profileWeight = profileMap[feature];
      if (typeof profileWeight !== "number" || profileWeight === 0) continue;
      const contribution = scorer.categoryWeight * profileWeight;
      total += contribution;
      contributors.push({ category: scorer.id, feature, weight: contribution });
    }
  }
  const sorted = orderBy(contributors, [(c) => c.weight], ["desc"]);
  return { profileScore: total, contributors: sorted };
}

/**
 * Resolves the profile to score against for one user, preferring the typed
 * profile and falling back to combined when the typed signal is thin. Returns
 * null when neither has any signal — the caller treats that as "no rerank."
 */
export function resolveEffectiveProfile(
  typed: PreferenceProfile | null,
  combined: PreferenceProfile | null,
): { profile: PreferenceProfile | null; bothThin: boolean } {
  const typedThin = !typed || typed.sampleSize < CONFIDENCE_THRESHOLDS.low;
  const combinedThin = !combined || combined.sampleSize < CONFIDENCE_THRESHOLDS.low;
  if (!typedThin) return { profile: typed, bothThin: false };
  if (!combinedThin) return { profile: combined, bothThin: false };
  return { profile: typed ?? combined, bothThin: typed !== null || combined !== null };
}

/** α_effective = 0.3 + (sampleSize / 15) × 0.4, clamped to [0.3, 0.7]. */
export function effectiveAlpha(sampleSize: number, alphaOverride?: number): number {
  const requested = alphaOverride ?? DEFAULT_ALPHA;
  if (sampleSize >= CONFIDENCE_THRESHOLDS.low) return requested;
  const scaled = MIN_ALPHA + (sampleSize / CONFIDENCE_THRESHOLDS.low) * (requested - MIN_ALPHA);
  return Math.max(MIN_ALPHA, Math.min(requested, scaled));
}

/**
 * The public ranker. Scores every candidate against the profile, normalizes
 * across the set, and blends with the upstream order. Returns per-candidate
 * metadata so callers can render match reasons for only the items they'll
 * surface.
 */
export function rankCandidatesAgainst(
  candidates: ReadonlyArray<{ item: MediaItem; features: CandidateFeatures }>,
  profile: PreferenceProfile | null,
  opts: ScoringOptions = {},
): RankedCandidate[] {
  if (candidates.length === 0) return [];
  const confidence: Confidence = profile?.confidence ?? "low";
  const sampleSize = profile?.sampleSize ?? 0;
  const alpha = profile ? effectiveAlpha(sampleSize, opts.alpha) : 0;

  const scored: CandidateScore[] = candidates.map((candidate, index) => {
    if (!profile) return { index, profileScore: 0, contributors: [] };
    const { profileScore, contributors } = scoreCandidate(candidate.features, profile);
    return { index, profileScore, contributors };
  });

  const maxProfileScore = Math.max(0, ...scored.map((s) => s.profileScore));
  const lastIndex = Math.max(1, candidates.length - 1);

  const ranked = scored.map((entry) => {
    const candidate = candidates[entry.index]!;
    const normProfile = maxProfileScore > 0 ? entry.profileScore / maxProfileScore : 0;
    const normUpstream = 1 - entry.index / lastIndex;
    const finalScore = alpha * normProfile + (1 - alpha) * normUpstream;
    return {
      item: candidate.item,
      score: clampUnit(finalScore),
      profileScore: entry.profileScore,
      confidence,
      topContributors: entry.contributors.slice(0, TOP_CONTRIBUTORS),
      features: candidate.features,
    };
  });
  return orderBy(ranked, [(x) => x.score], ["desc"]);
}

/**
 * Produces a normalized profile (weights summing to 1 per category). Normalized
 * profiles keep scoring stable across profiles with different total signal; we
 * apply it at rebuild time and leave incremental updates un-normalized.
 */
export function normalizeProfile(features: ProfileFeatures): ProfileFeatures {
  const out = {} as ProfileFeatures;
  for (const scorer of SCORERS) {
    out[scorer.id] = normalizeMap(features[scorer.id]);
  }
  return out;
}

function normalizeMap(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map);
  if (entries.length === 0) return {};
  const totalMagnitude = entries.reduce((acc, [, weight]) => acc + Math.abs(weight), 0);
  if (totalMagnitude === 0) return {};
  const normalized: Record<string, number> = {};
  for (const [key, weight] of entries) {
    normalized[key] = weight / totalMagnitude;
  }
  return normalized;
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export { DEFAULT_ALPHA, MIN_ALPHA, TOP_CONTRIBUTORS, CATEGORY_WEIGHTS, type FeatureScorer };

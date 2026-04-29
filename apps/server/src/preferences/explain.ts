import { orderBy } from "es-toolkit/array";
import type {
  FeatureCategory,
  FeedbackAction,
  PreferenceProfile,
} from "@ent-mcp/shared/preferences";
import { SCORERS, isDictScorer } from "./features";
import { decadeFor } from "./features/decades";
import { runtimeBucketFor } from "./features/runtime";
import type { CandidateFeatures, FeatureContribution } from "./types";
import { scoreCandidate } from "./scoring";

const MIN_CONTRIBUTION_FRACTION = 0.1;
const JOIN_CONTRIBUTOR_LIMIT = 2;
const REASON_CHAR_LIMIT = 100;

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  hi: "Hindi",
  ru: "Russian",
  ar: "Arabic",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  nl: "Dutch",
  tr: "Turkish",
  pl: "Polish",
  cs: "Czech",
  th: "Thai",
};

const RUNTIME_LABELS = {
  short: "short",
  medium: "medium-length",
  long: "long",
  very_long: "very long",
} as const;

/**
 * Renders the top-N contributor set as a sentence. Accepts the already-scored
 * contributor list so callers don't re-score candidates they just ranked.
 */
export function renderMatchReason(contributors: readonly FeatureContribution[]): string | null {
  if (contributors.length === 0) return null;
  const total = contributors.reduce((acc, c) => acc + c.weight, 0);
  if (total <= 0) return null;
  const picked = contributors
    .filter((c) => c.weight / total >= MIN_CONTRIBUTION_FRACTION)
    .slice(0, JOIN_CONTRIBUTOR_LIMIT);
  if (picked.length === 0) return null;
  const phrases = picked.map(renderContributor);
  const sentence = joinPhrases(phrases);
  return truncate(sentence, REASON_CHAR_LIMIT);
}

/**
 * Computes `explainMatch` end-to-end from raw inputs. Used by callers that
 * didn't retain the contributor list from ranking (and by the first-time-item
 * preview path).
 */
export function explainAgainstProfile(
  candidate: CandidateFeatures,
  profile: PreferenceProfile | null,
): string | null {
  if (!profile) return null;
  const { contributors } = scoreCandidate(candidate, profile);
  return renderMatchReason(contributors);
}

/**
 * Pure-function preview: no profile mutation, no feedback_log read. Returns
 * the flavor string the MCP handler bakes into its response. Intentionally
 * allowed to disagree slightly with the eventual job's write — the job is the
 * source of truth.
 */
export function renderProfileUpdate(
  candidate: CandidateFeatures,
  action: FeedbackAction,
  profile: PreferenceProfile | null,
  opts: { sentiment?: "positive" | "negative" | "neutral"; title?: string } = {},
): string | null {
  const sentiment = resolveSentiment(action, opts.sentiment);
  if (sentiment === "neutral") {
    const title = opts.title ?? candidate.title ?? "this title";
    return `Noted your feedback on ${title}.`;
  }
  const topFeature = pickTopFeature(candidate, profile);
  if (!topFeature) return null;
  const phrase = renderFeatureNoun(topFeature.category, topFeature.feature);
  return sentiment === "positive"
    ? `Reinforces your preference for ${phrase}.`
    : `Decreased preference for ${phrase}.`;
}

function resolveSentiment(
  action: FeedbackAction,
  sentiment?: "positive" | "negative" | "neutral",
): "positive" | "negative" | "neutral" {
  if (action === "like") return "positive";
  if (action === "dislike") return "negative";
  if (action === "note") return sentiment ?? "neutral";
  // Rate: handled by caller passing sentiment explicitly based on rating bucket.
  return sentiment ?? "neutral";
}

/**
 * Picks the single feature the candidate would most reinforce. Prefers the
 * feature with the highest `categoryWeight × existingProfileWeight`, falling
 * back to the raw category-weight ordering when the profile is thin.
 */
// fallow-ignore-next-line complexity
function pickTopFeature(
  candidate: CandidateFeatures,
  profile: PreferenceProfile | null,
): FeatureContribution | null {
  const contributions: FeatureContribution[] = [];
  for (const scorer of SCORERS) {
    if (!isDictScorer(scorer)) continue;
    const dict = scorer.extract(candidate);
    for (const feature of Object.keys(dict)) {
      const profileWeight = profile?.features[scorer.id][feature];
      const weight =
        typeof profileWeight === "number" && profileWeight > 0
          ? scorer.categoryWeight * profileWeight
          : scorer.categoryWeight;
      contributions.push({ category: scorer.id, feature, weight });
    }
  }
  if (contributions.length === 0) return null;
  const sorted = orderBy(contributions, [(c) => c.weight], ["desc"]);
  return sorted[0] ?? null;
}

/** Renders a contributor into a clause using the per-category template. */
// fallow-ignore-next-line complexity
function renderContributor(contribution: FeatureContribution): string {
  const noun = renderFeatureNoun(contribution.category, contribution.feature);
  switch (contribution.category) {
    case "genres":
      return `Matches your interest in ${noun}`;
    case "keywords":
      return `you tend to like films with ${noun}`;
    case "people":
      return `from ${noun} whose work you've enjoyed`;
    case "decades":
      return `from the ${noun} which you favor`;
    case "runtimes":
      return `a ${noun} runtime fits your preference`;
    case "languages":
      return `matches your taste for ${noun} cinema`;
  }
}

// fallow-ignore-next-line complexity
function renderFeatureNoun(category: FeatureCategory, feature: string): string {
  switch (category) {
    case "genres":
      return feature.toLowerCase();
    case "keywords":
      return feature.toLowerCase();
    case "people":
      return stripPersonPrefix(feature);
    case "decades":
      return feature;
    case "runtimes":
      return RUNTIME_LABELS[feature as keyof typeof RUNTIME_LABELS] ?? feature;
    case "languages":
      return LANGUAGE_NAMES[feature] ?? feature.toUpperCase();
  }
}

function stripPersonPrefix(label: string): string {
  const idx = label.indexOf(":");
  if (idx <= 0) return label;
  return label.slice(idx + 1);
}

/** "A" + first phrase capitalized, subsequent phrases lower-cased and joined. */
function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) return "";
  const first = capitalize(phrases[0]!);
  const rest = phrases.slice(1);
  if (rest.length === 0) return `${first}.`;
  return `${first} and ${rest.join(" and ")}.`;
}

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export { decadeFor, runtimeBucketFor };

import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../types";

/**
 * Structural tags describe franchise or meta-attributes rather than content.
 * Without filtering, these pollute the profile — observed output included
 * "aftercreditsstinger" ranking 4th in the normalized keyword profile.
 */
export const STRUCTURAL_TAGS = new Set<string>([
  "aftercreditsstinger",
  "duringcreditsstinger",
  "beforecreditsstinger",
  "sequel",
  "reboot",
  "spin off",
  "live action remake",
  "marvel cinematic universe (mcu)",
  "dc extended universe (dceu)",
]);

/**
 * Tone and mood descriptors dilute content signal when mixed into keywords.
 * A single TV show contributed 37 tone keywords at equal weight in observed
 * data, consuming ~24% of the 200-keyword budget. If mood scoring is added
 * later it belongs in a dedicated `moods` category, not silently mixed here.
 */
export const TONE_DESCRIPTORS = new Set<string>([
  "excited",
  "intense",
  "sentimental",
  "whimsical",
  "wistful",
  "complex",
  "dramatic",
  "suspicious",
  "blunt",
]);

function isFilteredKeyword(keyword: string): boolean {
  return STRUCTURAL_TAGS.has(keyword) || TONE_DESCRIPTORS.has(keyword);
}

export const keywordsScorer: FeatureScorer = {
  id: "keywords",
  categoryWeight: CATEGORY_WEIGHTS.keywords,
  extract(item) {
    const out: Record<string, number> = {};
    for (const keyword of item.keywords ?? []) {
      const key = keyword.trim().toLowerCase();
      if (key.length === 0) continue;
      if (isFilteredKeyword(key)) continue;
      out[key] = 1;
    }
    return out;
  },
};

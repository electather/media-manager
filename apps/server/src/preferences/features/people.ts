import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../types";

const CAST_LIMIT = 5;

export const peopleScorer: FeatureScorer = {
  id: "people",
  categoryWeight: CATEGORY_WEIGHTS.people,
  // fallow-ignore-next-line complexity
  extract(item) {
    const out: Record<string, number> = {};
    if (item.director) {
      out[`Director:${item.director}`] = 1;
    }
    for (const writer of item.writers ?? []) {
      out[`Writer:${writer}`] = 1;
    }
    for (const creator of item.creators ?? []) {
      out[`Creator:${creator}`] = 1;
    }
    const cast = (item.cast ?? []).slice(0, CAST_LIMIT);
    for (const actor of cast) {
      out[`Actor:${actor}`] = 1;
    }
    return out;
  },
};

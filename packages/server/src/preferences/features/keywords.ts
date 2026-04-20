import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../types";

export const keywordsScorer: FeatureScorer = {
  id: "keywords",
  categoryWeight: CATEGORY_WEIGHTS.keywords,
  extract(item) {
    const out: Record<string, number> = {};
    for (const keyword of item.keywords ?? []) {
      const key = keyword.trim().toLowerCase();
      if (key.length === 0) continue;
      out[key] = 1;
    }
    return out;
  },
};

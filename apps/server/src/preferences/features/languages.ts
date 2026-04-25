import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../types";

export const languagesScorer: FeatureScorer = {
  id: "languages",
  categoryWeight: CATEGORY_WEIGHTS.languages,
  extract(item) {
    const lang = item.originalLanguage?.trim().toLowerCase();
    if (!lang) return {};
    return { [lang]: 1 };
  },
};

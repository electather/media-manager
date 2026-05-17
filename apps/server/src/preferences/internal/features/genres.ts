import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../constants";

export const genresScorer: FeatureScorer = {
  id: "genres",
  categoryWeight: CATEGORY_WEIGHTS.genres,
  extract(item) {
    const out: Record<string, number> = {};
    for (const genre of item.genres ?? []) {
      const key = genre.trim();
      if (key.length === 0) continue;
      out[key] = 1;
    }
    return out;
  },
};

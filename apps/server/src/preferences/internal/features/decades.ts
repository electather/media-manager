import type { FeatureScorer } from "./index";
import { CATEGORY_WEIGHTS } from "../constants";

/** Maps a release year to its decade label, e.g. 1997 → "1990s". */
export function decadeFor(year: number): string {
  const bucket = Math.floor(year / 10) * 10;
  return `${bucket}s`;
}

export const decadesScorer: FeatureScorer = {
  id: "decades",
  categoryWeight: CATEGORY_WEIGHTS.decades,
  extract(item) {
    if (typeof item.year !== "number" || Number.isNaN(item.year)) return {};
    return { [decadeFor(item.year)]: 1 };
  },
};

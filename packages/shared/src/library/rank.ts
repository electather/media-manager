import { QUALITY_TIERS } from "./enums";

// Bottom-rank sentinel for labels outside QUALITY_TIERS (design §Known fuzzy
// areas: quality tier rank). QUALITY_TIERS.length is stable — always one past
// the last in-tuple index, so unranked labels sort below every real tier.
export const QUALITY_RANK_UNRANKED = QUALITY_TIERS.length;

// Maps a quality label to its fidelity ordinal (index in hi→lo QUALITY_TIERS,
// else QUALITY_RANK_UNRANKED). Canonical rank shared by the server Quality lens
// (SQL CASE qualityRankCase / cursor) and the client facet sort — they MUST
// agree value-for-value or ORDER BY and cursor predicate disagree at page
// boundaries (phase-2 lesson).
export function rankQualityTier(label: string): number {
  const index = QUALITY_TIERS.indexOf(label as (typeof QUALITY_TIERS)[number]);
  return index === -1 ? QUALITY_RANK_UNRANKED : index;
}

import { QUALITY_TIERS } from "@nama/shared/library";

// Deterministic rank for unknown quality labels: any label not in QUALITY_TIERS
// ranks below all listed tiers (design §Known fuzzy areas: quality tier rank).
// Uses QUALITY_TIERS.length as stable sentinel (always > any in-tuple index).
const UNRANKED = QUALITY_TIERS.length;

// Maps quality label to fidelity ordinal (index in hi→lo QUALITY_TIERS, or
// UNRANKED). Must agree value-for-value with SQL CASE in qualityRankCase: if
// they diverge, cursor predicate and ORDER BY disagree at page boundaries.
export function rankQualityTier(label: string): number {
  const index = QUALITY_TIERS.indexOf(label as (typeof QUALITY_TIERS)[number]);
  return index === -1 ? UNRANKED : index;
}

// Bottom-rank sentinel exported so SQL CASE uses same ELSE as rankQualityTier
// fallback — must share identical rank expression or rows drop/duplicate at
// page boundary (phase-2 lesson).
export const QUALITY_RANK_UNRANKED = UNRANKED;

import { QUALITY_TIERS } from "@ent-mcp/shared/library";

/**
 * The deterministic rank for an unknown quality label: every label not in
 * `QUALITY_TIERS` ranks BELOW every listed tier (design §Known fuzzy areas:
 * quality tier rank). `QUALITY_TIERS` is a fixed, short tuple, so its length is
 * always a strictly larger ordinal than any in-tuple index — a stable sentinel
 * that needs no magic number.
 */
const UNRANKED = QUALITY_TIERS.length;

/**
 * Maps a free-form quality label to its fidelity ordinal: the index in the
 * hi→lo `QUALITY_TIERS` tuple (0 = highest fidelity), or `UNRANKED` for any
 * label the tuple does not list. The Quality lens sorts these ASCENDING so a
 * smaller ordinal (higher fidelity) comes first; an unknown label sinks to the
 * bottom. Pure and deterministic so it is unit-testable in isolation, and so it
 * agrees value-for-value with the SQL CASE {@link qualityRankCase} builds — the
 * two MUST stay in lockstep or the cursor predicate and the `ORDER BY` would
 * disagree at a page boundary.
 */
export function rankQualityTier(label: string): number {
  const index = QUALITY_TIERS.indexOf(label as (typeof QUALITY_TIERS)[number]);
  return index === -1 ? UNRANKED : index;
}

/**
 * The bottom-rank sentinel ordinal for any label outside `QUALITY_TIERS`,
 * exported so the repo's SQL `CASE` can use the SAME `ELSE` value as
 * {@link rankQualityTier}'s fallback. The repo builds the `CASE` from
 * `QUALITY_TIERS` (one arm per tier, this value in the `ELSE`) so the SQL rank
 * and the TS rank agree value-for-value — the cursor predicate and the
 * `ORDER BY` must share an identical rank expression or rows drop/duplicate at
 * the page boundary (phase-2 lesson).
 */
export const QUALITY_RANK_UNRANKED = UNRANKED;

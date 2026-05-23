import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { MoodId } from "@ent-mcp/shared/watchlist";
import { MOOD_IDS, MOOD_RULES } from "./registry";

/**
 * Pure mood derivation over `(row, metadata)`. No I/O, no randomness, no
 * time-dependent inputs (invariant V.WL3). `meta` undefined → no tags.
 */
export function derive(meta: CanonicalMetadata | undefined): MoodId[] {
  if (!meta) return [];
  const out: MoodId[] = [];
  for (const id of MOOD_IDS) {
    if (MOOD_RULES[id]({ meta })) out.push(id);
  }
  return out;
}

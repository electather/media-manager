import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { score, WEIGHTS } from "./score";

const MAX_ALTERNATES = 4;
// Half the ineligible penalty — any candidate below this is dominated by the
// ineligibility weight rather than diversity, runtime, or recency factors.
const INELIGIBLE_CUTOFF = WEIGHTS.ineligible / 2;

export interface TonightResult {
  items: CompactMediaItem[];
  partial: boolean;
}

/**
 * Pick `items[0]` as the hero and up to four alternates by descending score
 * with diversity penalty. Empty `candidates` → empty result. Sort is stable:
 * ties break by `id` to keep output deterministic across requests (V.WL4).
 */
// fallow-ignore-next-line complexity
export function pick(candidates: CompactMediaItem[], now: number = Date.now()): TonightResult {
  if (candidates.length === 0) return { items: [], partial: false };
  const heroScores = candidates.map((c) => ({ c, s: score(c, [], now) }));
  heroScores.sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));
  const hero = heroScores[0]!.c;
  const rest = heroScores.slice(1).map((x) => x.c);
  const alternates: CompactMediaItem[] = [];
  const prior: CompactMediaItem[] = [hero];
  for (const item of rest) {
    if (alternates.length >= MAX_ALTERNATES) break;
    const reScore = score(item, prior, now);
    if (reScore <= INELIGIBLE_CUTOFF) continue;
    alternates.push(item);
    prior.push(item);
  }
  return { items: [hero, ...alternates], partial: false };
}

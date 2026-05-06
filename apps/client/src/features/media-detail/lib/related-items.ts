import type { RowKind } from "@ent-mcp/shared/home";
import { MOCK_FEED } from "@/features/home/lib/mock-data";
import { ROW_ASPECT } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem, RowData } from "@/features/home/lib/types";

const RELATED_ROW_KIND: RowKind = "recommendedForYou";
const MAX_RELATED = 12;

/**
 * Pull "more like this" candidates from across the feed, ranked by shared kind
 * and overlapping genres. Mirrors the prototype's lightweight scoring without
 * hitting any backend. The current `item` is excluded.
 */
export function buildRelatedRow(item: HomeMediaItem): RowData {
  const myGenres = new Set(item.genres ?? []);
  const seen = new Set<string>();
  const candidates: { item: HomeMediaItem; score: number }[] = [];

  for (const row of MOCK_FEED.rows) {
    for (const candidate of row.items) {
      if (candidate.id === item.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);

      let score = 0;
      if (candidate.mediaType === item.mediaType) score += 2;
      for (const genre of candidate.genres ?? []) {
        if (myGenres.has(genre)) score += 1;
      }
      candidates.push({ item: candidate, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    id: `related-${item.id}`,
    kind: RELATED_ROW_KIND,
    items: candidates.slice(0, MAX_RELATED).map((entry) => entry.item),
    defaultAspect: ROW_ASPECT[RELATED_ROW_KIND],
  };
}

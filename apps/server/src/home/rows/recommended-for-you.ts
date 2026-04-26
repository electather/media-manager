import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, type RawMediaItem } from "../compact";

const ROW_ID = "recommendedForYou" as const satisfies RowKind;
const MAX_ITEMS = 60;
const OVER_FETCH_FACTOR = 3;

/**
 * Aggregate `recommendations@v1.getRecommendations`, then re-rank the union
 * with the host-owned `PreferenceEngine`. Over-fetch by 3× so re-ranking has
 * room to move titles without leaving the page short. `explainMatch` runs
 * only for the top-N actually returned to keep the per-row budget honest.
 *
 * Pagination uses an exclusion list: re-ranking can move a title between
 * pages, and the cursor carries the IDs already shown so they cannot
 * resurface. Cap is enforced on encode and decode (cursor.ts).
 */
export const recommendedForYouFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Recommended for You",
  requires: ["recommendations@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const { page, exclusion } = readCursor(opts.cursor);
    const overFetchLimit = opts.limit * OVER_FETCH_FACTOR;
    const result = await ctx.mediaService.getRecommendationsFeed({ limit: overFetchLimit });
    const candidates = filterCandidates(result.items as RawMediaItem[], exclusion);

    const ranked = await rankCandidates(ctx, candidates, opts.limit);

    const shownIds = new Set<string>();
    const items: CompactMediaItem[] = [];
    for (const ranked_item of ranked) {
      const compact = await buildItem(ctx, ranked_item.item, ranked_item.matchReason);
      if (!compact) continue;
      items.push(compact);
      shownIds.add(compact.id);
    }

    const nextExclusion = capExclusion([...exclusion, ...shownIds]);
    const reachedCap = page >= MAX_ITEMS / opts.limit - 1;
    const cursor =
      items.length === 0 || reachedCap
        ? null
        : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: page + 1, x: nextExclusion });
    return result.partial ? { items, cursor, partial: true } : { items, cursor };
  },

  async isEligible(_userId, loader) {
    return loader.hasPlugin("recommendations@v1");
  },
};

interface RankedItem {
  item: RawMediaItem;
  matchReason: string | null;
}

function readCursor(cursor: string | null): { page: number; exclusion: string[] } {
  if (!cursor) return { page: 0, exclusion: [] };
  const decoded = decodeCursor(ROW_ID, cursor);
  return { page: decoded.p, exclusion: decoded.x };
}

function filterCandidates(items: RawMediaItem[], exclusion: string[]): RawMediaItem[] {
  if (exclusion.length === 0) return items;
  const blocked = new Set(exclusion);
  return items.filter((item) => {
    const id = compositeId(item);
    return id ? !blocked.has(id) : true;
  });
}

function compositeId(item: RawMediaItem): string | null {
  const tmdbId = item.ids?.tmdb_id ?? null;
  if (!tmdbId) return null;
  return `${item.type}:${tmdbId}`;
}

/**
 * Calls `PreferenceEngine.rankCandidates` once for the union, takes the
 * top-N, then runs `explainMatch` only for the survivors. A profile that
 * is too thin to score returns the items in upstream order with no
 * `matchReason`, which is the design's "row renders, signal omitted"
 * degradation path.
 */
async function rankCandidates(
  ctx: RowFetchContext,
  candidates: RawMediaItem[],
  limit: number,
): Promise<RankedItem[]> {
  if (candidates.length === 0) return [];
  try {
    const ranked = await ctx.preferenceEngine.rankCandidates(
      ctx.userId,
      candidates as unknown as Parameters<typeof ctx.preferenceEngine.rankCandidates>[1],
      {},
    );
    const top = ranked.slice(0, limit);
    return Promise.all(
      top.map(async (entry) => {
        const item = (entry as { item: RawMediaItem }).item;
        const reason = await safeExplain(ctx, item);
        return { item, matchReason: reason };
      }),
    );
  } catch (err) {
    ctx.logger.warn("[home/rfy] rank failed; falling back to upstream order:", err);
    return candidates.slice(0, limit).map((item) => ({ item, matchReason: null }));
  }
}

async function safeExplain(ctx: RowFetchContext, item: RawMediaItem): Promise<string | null> {
  try {
    return await ctx.preferenceEngine.explainMatch(
      ctx.userId,
      item as unknown as Parameters<typeof ctx.preferenceEngine.explainMatch>[1],
    );
  } catch {
    return null;
  }
}

async function buildItem(
  ctx: RowFetchContext,
  item: RawMediaItem,
  matchReason: string | null,
): Promise<CompactMediaItem | null> {
  const compact = toCompact(item, matchReason ? { matchReason } : {});
  const status = await fetchStatus(ctx, compact.id);
  if (status) compact.status = status;
  return compact;
}

async function fetchStatus(
  ctx: RowFetchContext,
  id: string,
): Promise<CompactMediaItem["status"] | null> {
  const map = await ctx.dataloader.getStatusBatch([id]);
  const value = map[id];
  if (
    value === "available" ||
    value === "requested" ||
    value === "processing" ||
    value === "unavailable" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function capExclusion(ids: string[]): string[] {
  if (ids.length <= MAX_ITEMS) return ids;
  // Keep the most recent — most likely to resurface in the next ranking
  // pass and the most informative thing for the cursor to carry.
  return ids.slice(ids.length - MAX_ITEMS);
}

import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, toStatusOrUndefined, type RawMediaItem } from "../compact";

const ROW_ID = "trendingNow" as const satisfies RowKind;
const MAX_ITEMS = 60;

/**
 * Aggregate `recommendations@v1.getTrending`. Distinct from
 * `recommendedForYou`: trending items are the "everyone agrees" headline,
 * surfaced as-is — no PreferenceEngine re-rank, no `matchReason`. The row
 * still works on a fresh install with TMDB-only credentials.
 */
export const trendingNowFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Trending Now",
  requires: ["recommendations@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const page = readPage(opts.cursor);
    // Aggregate `recommendations@v1.getTrending` does not expose a page knob,
    // so over-fetch by `(page+1) * limit` and slice client-side. Same pattern
    // `newReleases` uses; without it pages > 0 are guaranteed empty.
    const result = await ctx.mediaService.getTrendingFeed({
      limit: opts.limit * (page + 1),
      deadlineMs: ctx.deadlineMs,
    });
    const slice = sliceForPage(result.items as RawMediaItem[], page, opts.limit);
    const items = await Promise.all(slice.map((item) => buildItem(ctx, item)));
    const usableItems = items.filter((item): item is CompactMediaItem => item !== null);

    const nextPage = page + 1;
    const reachedCap = nextPage * opts.limit >= MAX_ITEMS;
    const cursor =
      usableItems.length === 0 || reachedCap || slice.length < opts.limit
        ? null
        : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: nextPage });
    return result.partial
      ? { items: usableItems, cursor, partial: true }
      : { items: usableItems, cursor };
  },

  async isEligible(_userId, loader) {
    return loader.hasPlugin("recommendations@v1");
  },
};

function readPage(cursor: string | null): number {
  if (!cursor) return 0;
  return decodeCursor(ROW_ID, cursor).p;
}

function sliceForPage<T>(items: T[], page: number, limit: number): T[] {
  const dedup = dedupeByCompositeId(items as unknown as RawMediaItem[]);
  const start = page * limit;
  return dedup.slice(start, start + limit) as unknown as T[];
}

function dedupeByCompositeId(items: RawMediaItem[]): RawMediaItem[] {
  const seen = new Set<string>();
  const out: RawMediaItem[] = [];
  for (const item of items) {
    const id = item.ids?.tmdb_id ?? null;
    if (!id) {
      out.push(item);
      continue;
    }
    const key = `${item.type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function buildItem(
  ctx: RowFetchContext,
  item: RawMediaItem,
): Promise<CompactMediaItem | null> {
  const compact = toCompact(item);
  const map = await ctx.dataloader.getStatusBatch([compact.id]);
  const status = toStatusOrUndefined(map[compact.id]);
  if (status) compact.status = status;
  return compact;
}

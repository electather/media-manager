import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, toStatusOrUndefined, type RawMediaItem } from "../compact";

const ROW_ID = "yourWatchlist" as const satisfies RowKind;
const MAX_ITEMS = 200;

interface WatchlistEntry {
  item: RawMediaItem;
  addedAt: string;
}

/**
 * Aggregate `watchlist@v1.list`. Most-recently-added first; capped at 200,
 * which is the design's "users with long watchlists expect everything; UI
 * should offer a 'go to watchlist' affordance past that point" rule.
 */
export const yourWatchlistFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Your Watchlist",
  requires: ["watchlist@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const offset = readOffset(opts.cursor);
    const result = await ctx.mediaService.getWatchlistFeed();
    const data = result.items as WatchlistEntry[];
    const sorted = [...data].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
    const slice = sorted.slice(offset, offset + opts.limit);
    const items = await Promise.all(slice.map((entry) => buildItem(ctx, entry.item)));
    const usable = items.filter((item): item is CompactMediaItem => item !== null);

    const nextOffset = offset + slice.length;
    const cursor =
      slice.length < opts.limit || nextOffset >= MAX_ITEMS
        ? null
        : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, o: nextOffset });
    return result.partial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
  },

  async isEligible(_userId, loader) {
    return loader.hasPlugin("watchlist@v1");
  },
};

function readOffset(cursor: string | null): number {
  if (!cursor) return 0;
  return decodeCursor(ROW_ID, cursor).o;
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

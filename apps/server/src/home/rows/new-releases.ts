import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, toStatusOrUndefined, type RawMediaItem } from "../compact";

const ROW_ID = "newReleases" as const satisfies RowKind;
const MAX_ITEMS = 60;

/**
 * `metadata@v1.discover` with a recent-release filter. Always eligible —
 * even a TMDB-only install renders this row. Mixes movies and TV; the
 * dashboard can client-side filter by `mediaType` later if it wants.
 */
export const newReleasesFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "New Releases",
  requires: ["metadata@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const page = readPage(opts.cursor);
    // Round to the calendar day so the dispatcher's 24h positive cache key
    // is stable across requests within the same day. The upper bound is
    // `today + DAY_MS` (exclusive end-of-day) so titles released today are
    // still visible — switching to `today` would silently hide them.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const result = await ctx.mediaService.discoverFeed({
      limit: opts.limit * (page + 1),
      releaseDateGte: today - 90 * DAY_MS,
      releaseDateLte: today + DAY_MS,
      sort: "popularity_desc",
      deadlineMs: ctx.deadlineMs,
    });

    const merged = (result.items as RawMediaItem[]).slice(
      page * opts.limit,
      (page + 1) * opts.limit,
    );
    const items = await Promise.all(merged.map((item) => buildItem(ctx, item)));
    const usable = items.filter((item): item is CompactMediaItem => item !== null);

    const nextPage = page + 1;
    const reachedCap = nextPage * opts.limit >= MAX_ITEMS;
    const cursor =
      usable.length === 0 || reachedCap || merged.length < opts.limit
        ? null
        : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: nextPage });
    return result.partial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
  },

  async isEligible(): Promise<boolean> {
    // Always eligible: `metadata@v1` is assumed present (admin TMDB key in
    // the shared pool); when absent the fetch empties out and pagination
    // ends gracefully — no `home.row_unavailable`.
    return true;
  },
};

function readPage(cursor: string | null): number {
  if (!cursor) return 0;
  return decodeCursor(ROW_ID, cursor).p;
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

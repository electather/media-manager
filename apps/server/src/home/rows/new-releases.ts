import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, type RawMediaItem } from "../compact";

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
    const result = await ctx.mediaService.discoverFeed({
      limit: opts.limit * (page + 1),
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
  const status = map[compact.id];
  if (
    status === "available" ||
    status === "requested" ||
    status === "processing" ||
    status === "unavailable" ||
    status === "unknown"
  ) {
    compact.status = status;
  }
  return compact;
}

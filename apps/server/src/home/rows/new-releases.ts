import type { RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { encodeCursor } from "../cursor";
import { type RawMediaItem } from "../compact";
import { buildItem } from "./build-item";
import { readPage } from "./row-utils";
import { hydrateFromSnapshot } from "./snapshot-hydration";

const ROW_ID = "newReleases" as const satisfies RowKind;
const MAX_ITEMS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `metadata@v1.discover` with a recent-release filter. Always eligible —
 * even a TMDB-only install renders this row. The catalog's daily
 * discover snapshot is consulted first; on a snapshot miss the row falls
 * back to the live plugin path so behavior stays identical pre-warm.
 */
export const newReleasesFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "New Releases",
  requires: ["metadata@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const page = readPage(opts.cursor, ROW_ID);
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;

    const snapshot = await ctx.catalogService.getDiscoverFeed(
      "newReleases",
      "popularity_desc",
      today,
    );
    if (snapshot && snapshot.length > 0) {
      return hydrateFromSnapshot(ctx, {
        rowId: ROW_ID,
        refs: snapshot,
        page,
        limit: opts.limit,
        maxItems: MAX_ITEMS,
      });
    }

    return fetchFromLivePath(ctx, page, opts.limit, today);
  },

  async isEligible(): Promise<boolean> {
    // Always eligible: `metadata@v1` is assumed present (admin TMDB key in
    // the shared pool); when absent the fetch empties out and pagination
    // ends gracefully — no `home.row_unavailable`.
    return true;
  },
};

// fallow-ignore-next-line complexity
async function fetchFromLivePath(
  ctx: RowFetchContext,
  page: number,
  limit: number,
  today: number,
): Promise<RowFetchResult> {
  // Round to the calendar day so the dispatcher's 24h positive cache key
  // is stable across requests within the same day. The upper bound is
  // `today + DAY_MS` (exclusive end-of-day) so titles released today are
  // still visible — switching to `today` would silently hide them.
  const result = await ctx.mediaService.discoverFeed({
    limit: limit * (page + 1),
    releaseDateGte: today - 90 * DAY_MS,
    releaseDateLte: today + DAY_MS,
    sort: "popularity_desc",
    deadlineMs: ctx.deadlineMs,
  });

  const merged = (result.items as RawMediaItem[]).slice(page * limit, (page + 1) * limit);
  const items = await Promise.all(merged.map((item) => buildItem(ctx, item)));
  const usable = items.filter((item): item is CompactMediaItem => item !== null);

  const nextPage = page + 1;
  const reachedCap = nextPage * limit >= MAX_ITEMS;
  const cursor =
    usable.length === 0 || reachedCap || merged.length < limit
      ? null
      : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: nextPage });
  return result.partial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
}

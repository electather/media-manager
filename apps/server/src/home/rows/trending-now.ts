import type { RowKind } from "@ent-mcp/shared/home";
import { compact } from "es-toolkit/array";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { encodeCursor } from "../cursor";
import { type RawMediaItem } from "../compact";
import { buildItem } from "./build-item";
import { compositeId, readPage } from "./row-utils";
import { tryHydrateFromDiscoverSnapshot } from "./snapshot-hydration";

const ROW_ID = "trendingNow" as const satisfies RowKind;
const MAX_ITEMS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregate `recommendations@v1.getTrending`. Distinct from
 * `recommendedForYou`: trending items are the "everyone agrees" headline,
 * surfaced as-is — no PreferenceEngine re-rank, no `matchReason`. The row
 * still works on a fresh install with TMDB-only credentials.
 *
 * The catalog's daily discover snapshot is consulted first so canonical
 * artwork (poster / backdrop / clearLogo) flows through even when the
 * underlying `recommendations@v1` provider returns image-less items
 * (e.g. Trakt). On a snapshot miss the row falls back to the live plugin
 * path so behavior stays identical pre-warm.
 */
export const trendingNowFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Trending Now",
  // fallow-ignore-next-line code-duplication
  requires: ["recommendations@v1"],

  // fallow-ignore-next-line complexity
  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const page = readPage(opts.cursor, ROW_ID);
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;

    const hydrated = await tryHydrateFromDiscoverSnapshot(ctx, {
      rowId: ROW_ID,
      feedKind: "trending",
      sort: "popularity_desc",
      day: today,
      page,
      limit: opts.limit,
      maxItems: MAX_ITEMS,
    });
    if (hydrated) return hydrated;

    // Aggregate `recommendations@v1.getTrending` does not expose a page knob,
    // so over-fetch by `(page+1) * limit` and slice client-side. Same pattern
    // `newReleases` uses; without it pages > 0 are guaranteed empty.
    const result = await ctx.mediaService.getTrendingFeed({
      limit: opts.limit * (page + 1),
      deadlineMs: ctx.deadlineMs,
    });
    const slice = sliceForPage(result.items as RawMediaItem[], page, opts.limit);
    const items = await Promise.all(slice.map((item) => buildItem(ctx, item)));
    const usableItems = compact(items);

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

function sliceForPage(items: RawMediaItem[], page: number, limit: number): RawMediaItem[] {
  const seen = new Set<string>();
  const dedup = items.filter((item) => {
    const id = compositeId(item);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const start = page * limit;
  return dedup.slice(start, start + limit);
}

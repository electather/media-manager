import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, parseCompactId, type RawMediaItem } from "../compact";

const ROW_ID = "becauseYouWatched" as const satisfies RowKind;
const MAX_ITEMS = 40;

/**
 * Per V11: the seed is delivered to the fetcher only through the cursor.
 * The layout handler synthesises the page-1 cursor from
 * `signals.recentSeed`; scroll pages echo `s` from the previous response.
 * We deliberately do NOT consult any signal snapshot here — the fetcher
 * sees only `RowFetchContext`, and the only durable seed reference is
 * `cursor.s`.
 */
export const becauseYouWatchedFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Because You Watched",
  requires: ["metadata@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    if (!opts.cursor) {
      // Layout handler is the only legitimate caller; it must always
      // synthesise a page-1 cursor before invoking this fetcher. A bare
      // `null` here means a `getRowContent` call lost the seed — degrade
      // gracefully rather than 500.
      return { items: [], cursor: null };
    }
    const decoded = decodeCursor(ROW_ID, opts.cursor);
    const seed = parseCompactId(decoded.s);
    if (!seed) return { items: [], cursor: null };

    const result = await ctx.mediaService.getSimilarFeed({
      id: seed.tmdbId,
      type: seed.mediaType,
    });
    const inProgress = await ctx.dataloader.getInProgressSet();
    const candidates = (result.items as RawMediaItem[]).filter((item) => {
      const id = compositeId(item);
      return id ? !inProgress.has(id) : true;
    });

    const slice = candidates.slice(decoded.p * opts.limit - opts.limit, decoded.p * opts.limit);
    const items = await Promise.all(slice.map((item) => buildItem(ctx, item)));
    const usable = items.filter((item): item is CompactMediaItem => item !== null);

    const nextPage = decoded.p + 1;
    const reachedCap = nextPage * opts.limit > MAX_ITEMS;
    const cursor =
      usable.length === 0 || reachedCap || slice.length < opts.limit
        ? null
        : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: nextPage, s: decoded.s });
    return result.partial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
  },

  async isEligible(_userId, loader) {
    return loader.hasPlugin("metadata@v1");
  },
};

function compositeId(item: RawMediaItem): string | null {
  const tmdbId = item.ids?.tmdb_id ?? null;
  if (!tmdbId) return null;
  return `${item.type}:${tmdbId}`;
}

async function buildItem(
  ctx: RowFetchContext,
  item: RawMediaItem,
): Promise<CompactMediaItem | null> {
  const compact = toCompact(item, { matchReason: "Similar to a recent watch" });
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

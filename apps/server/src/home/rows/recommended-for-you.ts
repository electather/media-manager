import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { MediaItem } from "@ent-mcp/shared/media";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import type { CanonicalMetadata, MetadataKey, RecItem } from "../../catalog/types";
import { decodeCursor, encodeCursor } from "../cursor";
import { canonicalToRaw, toCompact, toStatusOrUndefined, type RawMediaItem } from "../compact";
import { compositeId } from "./row-utils";
import { isNull } from "es-toolkit/predicate";

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
    const list = await ctx.catalogService.getRecommendations(ctx.userId, "default");
    if (list && list.items.length > 0) {
      return hydrateFromCatalog(ctx, list.items, list.profileVersion, opts);
    }
    return fetchFromLivePath(ctx, opts);
  },

  async isEligible(_userId, loader) {
    return loader.hasPlugin("recommendations@v1");
  },
};

interface RankedItem {
  item: RawMediaItem;
  matchReason: string | null;
}

/**
 * Catalog-hydration page reader. v2 cursors carry a `pv` (profile version)
 * so a profile rebuild mid-scroll resets pagination cleanly. v1 cursors
 * (live fallback) drop their exclusion list when we land in the catalog
 * path — the catalog list is pre-deduped, exclusion is unnecessary.
 */
function readCatalogCursor(cursor: string | null): { page: number; pv: number | null } {
  if (!cursor) return { page: 0, pv: null };
  const decoded = decodeCursor(ROW_ID, cursor);
  if ("pv" in decoded) return { page: decoded.p, pv: decoded.pv };
  return { page: decoded.p, pv: null };
}

/**
 * Live-fallback page reader. v2 cursors don't roundtrip through the live
 * path — if a catalog cursor lands here mid-flight (rec list expired), we
 * start fresh rather than carry the catalog page counter into the live
 * cap guard, which would otherwise short-circuit pagination on the first
 * page the user sees.
 */
function readLiveCursor(cursor: string | null): { page: number; exclusion: string[] } {
  if (!cursor) return { page: 0, exclusion: [] };
  const decoded = decodeCursor(ROW_ID, cursor);
  if ("x" in decoded) return { page: decoded.p, exclusion: decoded.x };
  return { page: 0, exclusion: [] };
}

// fallow-ignore-next-line complexity
async function hydrateFromCatalog(
  ctx: RowFetchContext,
  recItems: RecItem[],
  profileVersion: number,
  opts: RowFetchOptions,
): Promise<RowFetchResult> {
  const { page: requestedPage, pv } = readCatalogCursor(opts.cursor);
  // Profile rebuilt mid-scroll: drop the cursor and serve page 0 of the
  // freshly-versioned list. UX trade-off documented in the design's "Open
  // Questions"; consumers see this as a silent jump-to-top.
  const page = pv !== null && pv !== profileVersion ? 0 : requestedPage;

  const start = page * opts.limit;
  const slice = recItems.slice(start, start + opts.limit);
  if (slice.length === 0) return { items: [], cursor: null };

  const keys: MetadataKey[] = slice.map((entry) => ({
    tmdbId: entry.tmdbId,
    type: entry.mediaType,
  }));
  const rows = await ctx.catalogService.getMetadataBatch(keys);
  const hydrated: Array<{ canonical: CanonicalMetadata | null; rec: RecItem }> = slice.map(
    (rec) => ({
      canonical: rows[`${rec.mediaType}:${rec.tmdbId}`] ?? null,
      rec,
    }),
  );
  const isPartial = hydrated.some(({ canonical }) => isNull(canonical));
  const present = hydrated.filter(
    (entry): entry is { canonical: CanonicalMetadata; rec: RecItem } => entry.canonical !== null,
  );
  // Single batched status lookup for the whole hydrated page — replaces
  // the per-item `getStatusBatch([compact.id])` round-trips that the
  // live path also pays. We collect every compact id once and apply the
  // resolved status when shaping the wire row.
  const compactIds = present.map(({ canonical }) => `${canonical.mediaType}:${canonical.tmdbId}`);
  const statusMap = compactIds.length > 0 ? await ctx.dataloader.getStatusBatch(compactIds) : {};
  const items: CompactMediaItem[] = [];
  for (const { canonical, rec } of present) {
    const compact = buildFromCanonical(canonical, rec.matchReason, statusMap);
    if (compact) items.push(compact);
  }

  const nextStart = start + opts.limit;
  const exhausted = nextStart >= recItems.length;
  const reachedCap = nextStart >= MAX_ITEMS;
  const cursor =
    exhausted || reachedCap || items.length === 0
      ? null
      : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: page + 1, pv: profileVersion });
  return isPartial ? { items, cursor, partial: true } : { items, cursor };
}

async function fetchFromLivePath(
  ctx: RowFetchContext,
  opts: RowFetchOptions,
): Promise<RowFetchResult> {
  const { page, exclusion } = readLiveCursor(opts.cursor);
  const overFetchLimit = opts.limit * OVER_FETCH_FACTOR;
  const result = await ctx.mediaService.getRecommendationsFeed({
    limit: overFetchLimit,
    deadlineMs: ctx.deadlineMs,
  });
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
}

function buildFromCanonical(
  row: CanonicalMetadata,
  matchReason: string | null,
  statusMap: Record<string, string>,
): CompactMediaItem | null {
  const compact = toCompact(canonicalToRaw(row), matchReason ? { matchReason } : {});
  const status = toStatusOrUndefined(statusMap[compact.id]);
  if (status) compact.status = status;
  return compact;
}

function filterCandidates(items: RawMediaItem[], exclusion: string[]): RawMediaItem[] {
  if (exclusion.length === 0) return items;
  const blocked = new Set(exclusion);
  return items.filter((item) => {
    const id = compositeId(item);
    return id ? !blocked.has(id) : true;
  });
}

/**
 * Calls `PreferenceEngine.rankCandidates` once for the union, takes the
 * top-N, then runs `explainRanked` only for the survivors. `explainRanked`
 * reuses the features that `rankCandidates` already fetched, so the
 * top-N explanation pass does not trigger a second metadata fetch per
 * item. A profile that is too thin to score returns the items in upstream
 * order with no `matchReason`.
 */
async function rankCandidates(
  ctx: RowFetchContext,
  candidates: RawMediaItem[],
  limit: number,
): Promise<RankedItem[]> {
  if (candidates.length === 0) return [];
  const adapted = candidates.map(toPreferenceMediaItem);
  try {
    const ranked = await ctx.preferenceEngine.rankCandidates(ctx.userId, adapted, {});
    const top = ranked.slice(0, limit);
    return Promise.all(
      top.map(async (entry) => {
        const item = entry.item as unknown as RawMediaItem;
        const reason = await ctx.preferenceEngine
          .explainRanked(ctx.userId, entry)
          .catch(() => null);
        return { item, matchReason: reason };
      }),
    );
  } catch (err) {
    ctx.logger.warn("[home/rfy] rank failed; falling back to upstream order:", err);
    return candidates.slice(0, limit).map((item) => ({ item, matchReason: null }));
  }
}

/**
 * Adapter from the plugin-SDK `RawMediaItem` shape to the host
 * `@ent-mcp/shared/media` `MediaItem` shape that `PreferenceEngine` consumes.
 * Centralised here so a future change to either side surfaces in exactly one
 * place rather than as a runtime cast inside every fetcher.
 */
// fallow-ignore-next-line complexity
function toPreferenceMediaItem(item: RawMediaItem): MediaItem {
  return {
    id: item.id,
    title: item.title,
    year: typeof item.year === "number" ? item.year : 0,
    type: item.type,
    genres: item.genres ?? [],
    rating: item.rating ?? null,
    overview: item.overview ?? "",
    posterUrl: item.posterUrl ?? null,
    status: "unknown",
    userRating: item.userRating ?? null,
    matchReason: null,
  };
}

async function buildItem(
  ctx: RowFetchContext,
  item: RawMediaItem,
  matchReason: string | null,
): Promise<CompactMediaItem | null> {
  const compact = toCompact(item, matchReason ? { matchReason } : {});
  const map = await ctx.dataloader.getStatusBatch([compact.id]);
  const status = toStatusOrUndefined(map[compact.id]);
  if (status) compact.status = status;
  return compact;
}

function capExclusion(ids: string[]): string[] {
  if (ids.length <= MAX_ITEMS) return ids;
  // Keep the most recent — most likely to resurface in the next ranking
  // pass and the most informative thing for the cursor to carry.
  return ids.slice(ids.length - MAX_ITEMS);
}

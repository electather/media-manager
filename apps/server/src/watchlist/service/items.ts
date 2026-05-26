import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { ActiveRow } from "@ent-mcp/shared/media";
import {
  WATCHLIST_LIST_MAX_LIMIT,
  keyToId,
  type MoodId,
  type WatchlistBucket,
  type WatchlistItem,
  type WatchlistResponse,
  type WatchlistSectionResponse,
  type WatchlistSort,
} from "@ent-mcp/shared/watchlist";
import {
  decodeCursor,
  encodeCursor,
  enrich,
  getMatchingServersCached,
  hasActiveRows,
  hasUserSeeded,
  listActiveRowsKeyset,
  listAllActiveRows,
  listAvailableCandidates,
  type EnrichOptions,
  type PageCursor,
} from "../../media";
import { derive as deriveMoods } from "../moods/derive";
import { asWatchlistContext, type MaybeRowContext, type ResolvedWatchlistContext } from "./context";
import { clampLimit, decodeOffsetCursor, encodeOffsetCursor } from "./cursor";
import { seedFromPlugins } from "./seed";

export interface GetItemsOptions {
  /** Opaque keyset cursor from a previous response. Omit on the first page. */
  cursor?: string;
  /** Page size cap. Defaults to 60, hard-capped at 200 to match the wire schema. */
  limit?: number;
}

/**
 * Keyset-paginated read of the user's active watchlist. First page without a
 * cursor triggers a plugin seed when the user has never been seeded.
 */
// fallow-ignore-next-line complexity
export async function getItems(
  ctx: MaybeRowContext,
  opts: GetItemsOptions = {},
): Promise<WatchlistResponse> {
  // fallow-ignore-next-line code-duplication
  const c = asWatchlistContext(ctx);
  const limit = clampLimit(opts.limit);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  let partial = false;

  if (!cursor && !(await hasUserSeeded(c.userId))) {
    if (!(await hasActiveRows(c.userId))) {
      const seedRes = await seedFromPlugins(c);
      partial = partial || seedRes.partial;
    }
  }

  const rows = await listActiveRowsKeyset(c.userId, {
    limit,
    ...(cursor ? { cursor } : {}),
  });
  if (rows.length === 0) {
    return { items: [], cursor: null, partial };
  }
  const enriched = await enrich(rows, c);
  const last = rows[rows.length - 1]!;
  const nextCursor =
    rows.length < limit ? null : encodeCursor({ addedAt: last.addedAt, id: last.id });
  return {
    items: enriched.items,
    cursor: nextCursor,
    partial: partial || enriched.partial,
  };
}

/**
 * Returns up to `limit` active items the user actually has on a connected
 * library server. Pre-filters by `getMatchingServers` before the enrich
 * fan-out so we don't pay the metadata batch for items the user can't play.
 *
 * Triggers a seed when the user has no active rows and has not been seeded
 * yet, then retries once.
 */
// fallow-ignore-next-line complexity
export async function listAvailable(
  limit: number,
  ctx: MaybeRowContext,
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  let partial = false;
  let candidates = await listAvailableCandidates(c.userId, limit * 4);
  if (candidates.length === 0 && !(await hasUserSeeded(c.userId))) {
    const seedRes = await seedFromPlugins(c);
    partial = partial || seedRes.partial;
    candidates = await listAvailableCandidates(c.userId, limit * 4);
  }
  if (candidates.length === 0) return { items: [], cursor: null, partial };

  const probes = await Promise.allSettled(
    candidates.map((row) =>
      getMatchingServersCached(c.userId, c.mediaService, row.tmdbId, row.mediaType),
    ),
  );
  const picked: ActiveRow[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (picked.length >= limit) break;
    const probe = probes[i]!;
    if (probe.status !== "fulfilled") {
      partial = true;
      continue;
    }
    if (probe.value.length > 0) picked.push(candidates[i]!);
  }
  if (picked.length === 0) return { items: [], cursor: null, partial };

  const enriched = await enrich(picked, c);
  return { items: enriched.items, cursor: null, partial: partial || enriched.partial };
}

export async function hasAny(userId: string): Promise<boolean> {
  return hasActiveRows(userId);
}

export interface ListItemsOptions {
  cursor?: string;
  limit?: number;
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

const MAX_EMPTY_HOPS = 2;
const OVERSHOOT_FACTOR = 3;
const MAX_MOOD_HOPS = 20;
const OFFSET_FULL_LOAD_WARN_ROWS = 1000;

const STATUS_PRIORITY: Record<NonNullable<WatchlistItem["status"]>, number> = {
  available: 0,
  processing: 1,
  requested: 2,
  unavailable: 3,
  unknown: 4,
};

// fallow-ignore-next-line complexity
function compareAlpha(aMeta?: CanonicalMetadata, bMeta?: CanonicalMetadata): number {
  const at = (aMeta?.title ?? "").toLocaleLowerCase().normalize("NFD");
  const bt = (bMeta?.title ?? "").toLocaleLowerCase().normalize("NFD");
  return at.localeCompare(bt);
}

// fallow-ignore-next-line complexity
function compareRuntime(aMeta?: CanonicalMetadata, bMeta?: CanonicalMetadata): number {
  const ar = aMeta?.runtimeMinutes ?? Number.POSITIVE_INFINITY;
  const br = bMeta?.runtimeMinutes ?? Number.POSITIVE_INFINITY;
  return ar - br;
}

function statusRank(id: string, statusMap: Record<string, string>): number {
  const status = (statusMap[id] ?? "unknown") as NonNullable<WatchlistItem["status"]>;
  return STATUS_PRIORITY[status] ?? 9;
}

function compareForSort(
  a: ActiveRow,
  b: ActiveRow,
  metaMap: Record<string, CanonicalMetadata>,
  statusMap: Record<string, string>,
  sort: Exclude<WatchlistSort, "recent">,
): number {
  const aId = keyToId({ tmdbId: a.tmdbId, mediaType: a.mediaType });
  const bId = keyToId({ tmdbId: b.tmdbId, mediaType: b.mediaType });
  if (sort === "alpha") return compareAlpha(metaMap[aId], metaMap[bId]);
  if (sort === "runtime") return compareRuntime(metaMap[aId], metaMap[bId]);
  return statusRank(aId, statusMap) - statusRank(bId, statusMap);
}

/**
 * Paginated list of watchlist items with sort, bucket, and mood filters. When
 * `bucket` is omitted, `unknown`-classified rows are included so the page
 * surfaces every active row.
 */
// fallow-ignore-next-line complexity
export async function listItems(
  ctx: MaybeRowContext,
  opts: ListItemsOptions = {},
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  const limit = clampLimit(opts.limit);
  const sort: WatchlistSort = opts.sort ?? "recent";

  if (sort !== "recent") {
    return listItemsOffset(c, sort, limit, opts);
  }

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  const fetchSize =
    opts.bucket || opts.mood ? Math.min(limit * OVERSHOOT_FACTOR, WATCHLIST_LIST_MAX_LIMIT) : limit;

  let scanCursor: PageCursor | undefined = cursor ?? undefined;
  let collectedItems: WatchlistItem[] = [];
  let enrichPartial = false;
  let nextCursor: string | null = null;

  // fallow-ignore-next-line code-duplication
  for (let hop = 0; hop <= MAX_EMPTY_HOPS; hop++) {
    const rows = await listActiveRowsKeyset(c.userId, {
      limit: fetchSize,
      ...(scanCursor ? { cursor: scanCursor } : {}),
    });
    if (rows.length === 0) {
      nextCursor = null;
      break;
    }
    const filtered = opts.mood
      ? await filterByMood(rows, c, opts.mood)
      : {
          rows,
          partial: false,
          metadata: undefined as Record<string, CanonicalMetadata> | undefined,
        };
    if (filtered.partial) enrichPartial = true;
    const enrichOpts: EnrichOptions = {};
    if (opts.bucket) enrichOpts.filter = opts.bucket;
    if (filtered.metadata) enrichOpts.prefetchedMetadata = filtered.metadata;
    const enriched = await enrich(filtered.rows, c, enrichOpts);
    if (enriched.partial) enrichPartial = true;
    collectedItems = enriched.items.slice(0, limit);
    const collectedSources = enriched.sources.slice(0, limit);
    const lastScanned = rows[rows.length - 1]!;
    const exhausted = rows.length < fetchSize;

    if (collectedItems.length > 0) {
      if (collectedSources.length === collectedItems.length) {
        const lastReturned = collectedSources[collectedSources.length - 1]!;
        nextCursor =
          exhausted && enriched.items.length <= limit
            ? null
            : encodeCursor({ addedAt: lastReturned.addedAt, id: lastReturned.id });
      } else {
        nextCursor = exhausted
          ? null
          : encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id });
      }
      break;
    }

    nextCursor = exhausted
      ? null
      : encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id });
    if (exhausted) break;
    scanCursor = { addedAt: lastScanned.addedAt, id: lastScanned.id };
  }

  return { items: collectedItems, cursor: nextCursor, partial: enrichPartial };
}

async function filterByMood(
  rows: ActiveRow[],
  ctx: ResolvedWatchlistContext,
  mood: MoodId,
): Promise<{
  rows: ActiveRow[];
  partial: boolean;
  metadata: Record<string, CanonicalMetadata>;
}> {
  let partial = false;
  // fallow-ignore-next-line code-duplication
  const metadata = await ctx.catalog
    .getMetadataBatch(rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType })))
    .catch((err) => {
      ctx.log.warn("[watchlist:listItems] mood meta batch failed", err);
      partial = true;
      return {} as Record<string, CanonicalMetadata>;
    });
  const kept = rows.filter((r) =>
    deriveMoods(metadata[keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })]).includes(mood),
  );
  return { rows: kept, partial, metadata };
}

// fallow-ignore-next-line complexity
async function listItemsOffset(
  ctx: ResolvedWatchlistContext,
  sort: Exclude<WatchlistSort, "recent">,
  limit: number,
  opts: ListItemsOptions,
): Promise<WatchlistResponse> {
  const offset = opts.cursor ? (decodeOffsetCursor(opts.cursor) ?? 0) : 0;
  const all = await listAllActiveRows(ctx.userId);
  if (all.length === 0) return { items: [], cursor: null, partial: false };
  if (all.length > OFFSET_FULL_LOAD_WARN_ROWS) {
    ctx.log.warn(
      `[watchlist:listItems] full-load scan over ${all.length} rows exceeds advisory ${OFFSET_FULL_LOAD_WARN_ROWS}-row ceiling (RISK-005)`,
    );
  }

  let partial = false;
  const compositeIds = all.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const [statusMap, metaMap] = await Promise.all([
    ctx.mediaService.getStatusBatch(compositeIds).catch((err) => {
      ctx.log.warn("[watchlist:listItems] getStatusBatch failed", err);
      partial = true;
      return {} as Record<string, string>;
    }),
    ctx.catalog
      .getMetadataBatch(all.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType })))
      .catch((err) => {
        ctx.log.warn("[watchlist:listItems] getMetadataBatch failed", err);
        partial = true;
        return {} as Record<string, CanonicalMetadata>;
      }),
  ]);

  let candidates = all;
  if (opts.mood) {
    candidates = candidates.filter((r) =>
      deriveMoods(metaMap[keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })]).includes(
        opts.mood!,
      ),
    );
  }
  const sorted = candidates.slice().sort((a, b) => compareForSort(a, b, metaMap, statusMap, sort));
  const window = sorted.slice(offset, offset + limit * OVERSHOOT_FACTOR);
  const enriched = await enrich(window, ctx, opts.bucket ? { filter: opts.bucket } : {});
  if (enriched.partial) partial = true;
  const slice = enriched.items.slice(0, limit);
  const sourcesSlice = enriched.sources.slice(0, limit);
  let scannedRows = window.length;
  if (slice.length === limit && sourcesSlice.length === limit) {
    const lastSource = sourcesSlice[sourcesSlice.length - 1]!;
    const lastIdx = window.findIndex((r) => r.id === lastSource.id);
    if (lastIdx >= 0) scannedRows = lastIdx + 1;
  }
  const nextOffset = offset + scannedRows;
  const cursor = nextOffset < sorted.length ? encodeOffsetCursor(nextOffset) : null;
  return { items: slice, cursor, partial };
}

/** Last-added items, capped by `limit`. No cursor. */
export async function getRecentlyAdded(
  ctx: MaybeRowContext,
  limit: number,
): Promise<WatchlistSectionResponse> {
  const c = asWatchlistContext(ctx);
  const rows = await listActiveRowsKeyset(c.userId, { limit });
  if (rows.length === 0) return { items: [], partial: false };
  const enriched = await enrich(rows, c);
  return { items: enriched.items, partial: enriched.partial };
}

export interface ListMoodItemsOptions {
  cursor?: string;
  limit?: number;
}

/**
 * Paginated rows for a specific mood. Reuses the keyset cursor pattern with
 * overshoot so sparse moods can scan several windows while making progress.
 */
// fallow-ignore-next-line complexity
export async function listMoodItems(
  ctx: MaybeRowContext,
  moodId: MoodId,
  opts: ListMoodItemsOptions = {},
): Promise<WatchlistResponse> {
  // fallow-ignore-next-line code-duplication
  const c = asWatchlistContext(ctx);
  const limit = clampLimit(opts.limit);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  const fetchSize = Math.min(limit * OVERSHOOT_FACTOR, WATCHLIST_LIST_MAX_LIMIT);

  let scanCursor: PageCursor | undefined = cursor ?? undefined;
  const collectedItems: WatchlistItem[] = [];
  const collectedSources: ActiveRow[] = [];
  let enrichPartial = false;
  let nextCursor: string | null = null;
  let emptyStreak = 0;

  // fallow-ignore-next-line code-duplication
  for (let hop = 0; hop < MAX_MOOD_HOPS; hop++) {
    const rows = await listActiveRowsKeyset(c.userId, {
      limit: fetchSize,
      ...(scanCursor ? { cursor: scanCursor } : {}),
    });
    if (rows.length === 0) {
      nextCursor = null;
      break;
    }
    const {
      rows: filtered,
      partial: moodPartial,
      metadata: moodMeta,
    } = await filterByMood(rows, c, moodId);
    if (moodPartial) enrichPartial = true;
    const enriched = await enrich(filtered, c, { prefetchedMetadata: moodMeta });
    if (enriched.partial) enrichPartial = true;
    const need = limit - collectedItems.length;
    if (enriched.items.length === 0) {
      emptyStreak++;
    } else {
      emptyStreak = 0;
      collectedItems.push(...enriched.items.slice(0, need));
      collectedSources.push(...enriched.sources.slice(0, need));
    }
    const lastScanned = rows[rows.length - 1]!;
    const exhausted = rows.length < fetchSize;
    if (collectedItems.length >= limit) {
      const last = collectedSources[collectedSources.length - 1] ?? lastScanned;
      nextCursor =
        exhausted && enriched.items.length <= need
          ? null
          : encodeCursor({ addedAt: last.addedAt, id: last.id });
      break;
    }
    if (exhausted) {
      nextCursor = null;
      break;
    }
    if (emptyStreak > MAX_EMPTY_HOPS) {
      nextCursor =
        collectedItems.length > 0
          ? encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id })
          : null;
      break;
    }
    scanCursor = { addedAt: lastScanned.addedAt, id: lastScanned.id };
  }

  return { items: collectedItems, cursor: nextCursor, partial: enrichPartial };
}

import type { ConsolaInstance } from "consola";
import { consola } from "consola";
import {
  keyToId,
  WATCHLIST_LIST_DEFAULT_LIMIT,
  WATCHLIST_LIST_MAX_LIMIT,
  type MoodId,
  type WatchlistBucket,
  type WatchlistCounts,
  type WatchlistItem,
  type WatchlistKey,
  type WatchlistMoodSummary,
  type WatchlistResponse,
  type WatchlistSectionResponse,
  type WatchlistSort,
  type WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { ActiveRow } from "@ent-mcp/shared/media";
import { ArtworkService } from "../artwork";
import { MemoryCache } from "../cache/memory";
import { toCanonicalRow, type CatalogService } from "../catalog";
import {
  addItem as mediaAddItem,
  removeItem as mediaRemoveItem,
  seedFromPlugins as mediaSeedFromPlugins,
  syncFromPlugins as mediaSyncFromPlugins,
  countBuckets,
  enrich,
  getMatchingServersCached,
  loadProgressMap,
  listAllActiveRows,
  listActiveRowsKeyset,
  listAvailableCandidates,
  hasActiveRows,
  hasUserSeeded,
  encodeCursor,
  decodeCursor,
  type AddItemResult,
  type EnrichOptions,
  type GetArtworkFn,
  type MediaService,
  type PageCursor,
  type SeedResult,
  type ToCanonicalRowFn,
} from "../media";

export type { AddItemResult, SeedResult };
import { derive as deriveMoods } from "./moods/derive";
import { getSummary as getMoodSummaryImpl } from "./moods/cluster";
import { getSection as getTonightSectionImpl } from "./tonight/section";

/**
 * Per-request context. Structurally compatible with the home row context so
 * `home/rows/your-watchlist.ts` can pass its existing `RowContext`.
 */
export interface WatchlistContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log: ConsolaInstance;
}

interface ResolvedWatchlistContext extends WatchlistContext {
  loadProgressMap: typeof loadProgressMap;
  getArtwork: GetArtworkFn;
  toCanonicalRow: ToCanonicalRowFn;
}

interface MaybeRowContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log?: ConsolaInstance;
  logger?: ConsolaInstance;
}

function asWatchlistContext(ctx: MaybeRowContext): ResolvedWatchlistContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    deadlineMs: ctx.deadlineMs,
    log: ctx.log ?? ctx.logger ?? consola,
    loadProgressMap,
    getArtwork: (requests) => new ArtworkService(ctx.userId, ctx.catalog).getArtwork(requests),
    toCanonicalRow,
  };
}

export interface GetItemsOptions {
  /** Opaque keyset cursor from a previous response. Omit on the first page. */
  cursor?: string;
  /** Page size cap. Defaults to 60, hard-capped at 200 to match the wire schema. */
  limit?: number;
}

/**
 * Keyset-paginated read of the user's active watchlist. First page (no
 * cursor) triggers a plugin seed when the user has never been seeded.
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

  // Seed only on the *first* page; cursor implies the user already has rows.
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

function clampLimit(value: number | undefined): number {
  if (value == null) return WATCHLIST_LIST_DEFAULT_LIMIT;
  if (value <= 0) return WATCHLIST_LIST_DEFAULT_LIMIT;
  return Math.min(value, WATCHLIST_LIST_MAX_LIMIT);
}

const COUNTS_CACHE_TTL_MS = 30_000;
const COUNTS_CACHE_MAX_ENTRIES = 5000;
const countsCache = new MemoryCache(COUNTS_CACHE_MAX_ENTRIES);

function countsCacheKey(userId: string): string {
  return `watchlist:counts:${userId}`;
}

/**
 * Returns cheap aggregate counts for the header pips. Delegates the per-row
 * bucket tally to media's `countBuckets` count-mode aggregate (design §G) —
 * `batchLoad → classify → tally`, NO artwork dispatch and NO cold-fill — so a
 * 1000-row watchlist costs one batch query plus 1000 cache hits (after the
 * first page warms the 30 s cache). This shell only owns the counts cache and
 * the `WatchlistCounts` wire mapping.
 */
export async function getCounts(ctx: MaybeRowContext): Promise<WatchlistCounts> {
  const c = asWatchlistContext(ctx);
  const cacheKey = countsCacheKey(c.userId);
  const hit = await countsCache.get<WatchlistCounts>(cacheKey);
  if (hit !== null) return hit;

  const rows = await listAllActiveRows(c.userId);
  const tally = await countBuckets(rows, c);

  const counts: WatchlistCounts = {
    ready: tally.ready,
    inProgress: tally["in-progress"],
    awaiting: tally.awaiting,
    unavailable: tally.unavailable,
    upcoming: tally.upcoming,
    total: rows.length,
  };
  await countsCache.set(cacheKey, counts, COUNTS_CACHE_TTL_MS);
  return counts;
}

export async function invalidateCounts(userId: string): Promise<void> {
  await countsCache.delete(countsCacheKey(userId));
}

/** Test-only. */
export async function __resetCountsCache(): Promise<void> {
  await countsCache.clear("watchlist:counts:");
}

/**
 * Idempotent add. The `watchlist_items` write + event now live in media
 * (design §M.2); this thin shell resolves the per-request context into the
 * enrich-ready shape and delegates.
 */
export async function addItem(
  key: WatchlistKey,
  source: WatchlistSource,
  ctx: MaybeRowContext,
): Promise<AddItemResult> {
  return mediaAddItem(key, source, asWatchlistContext(ctx));
}

/** Idempotent remove. Delegates to the media-owned `watchlist_items` write. */
export async function removeItem(
  key: WatchlistKey,
  ctx: MaybeRowContext,
): Promise<{ removed: boolean }> {
  return mediaRemoveItem(key, asWatchlistContext(ctx));
}

/**
 * Triggers a plugin seed. The `watchlist_items` bulk-insert now lives in media
 * (design §M.2); this thin shell resolves the per-request context and delegates.
 */
export async function seedFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  return mediaSeedFromPlugins(asWatchlistContext(ctx));
}

/** Periodic plugin merge. Delegates to the media-owned `watchlist_items` write. */
export async function syncFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  return mediaSyncFromPlugins(asWatchlistContext(ctx));
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

  // Probe matching servers in parallel — they're per-request memoized inside
  // MediaService, but each fresh key still triggers a plugin call, so a
  // sequential loop turned this into O(N) wall-clock latency on cold caches.
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

// ─────────────────────────────────────────────────────────────────────────
// Section endpoints — see docs/2026-05-23-watchlist-sections-design.md
// ─────────────────────────────────────────────────────────────────────────

export interface ListItemsOptions {
  cursor?: string;
  limit?: number;
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

const MAX_EMPTY_HOPS = 2;
const OVERSHOOT_FACTOR = 3;
/**
 * Total hop ceiling for mood pagination. Empty/sparse windows that don't
 * advance the accumulator burn one hop each; this caps how many we'll spend
 * before giving up so a pathologically large + pathologically sparse mood
 * doesn't pin a request. Scans up to `MAX_MOOD_HOPS * fetchSize` rows.
 */
const MAX_MOOD_HOPS = 20;

/**
 * Observability ceiling for `listItemsOffset` full-load scan (RISK-005).
 * Non-recent sorts pull every active row into memory before slicing, so a
 * user with thousands of items pays the full status + metadata batch on
 * every page fetch. We log a warn above this threshold so the trade-off
 * becomes visible before it turns into a latency incident; the limit is
 * advisory only — rows are still served — and graduates to a hard cap +
 * keyset-friendly sort backing in a follow-up.
 */
const OFFSET_FULL_LOAD_WARN_ROWS = 1000;

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`, "utf8").toString("base64url");
}

// fallow-ignore-next-line complexity
function decodeOffsetCursor(raw: string): number | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    if (!decoded.startsWith("offset:")) return null;
    const n = Number(decoded.slice("offset:".length));
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

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
 * Paginated list of watchlist items with sort + bucket + mood filters. When
 * `bucket` is omitted, `unknown`-classified rows are included so the page
 * surfaces every active row (V.WL2). `sort=recent` uses the existing keyset
 * cursor; `sort=alpha|runtime|status` use an offset cursor over the
 * snapshot ordering (V.WL1, best-effort under concurrent mutation).
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

  // Recent / keyset path — mirrors getItems but applies bucket + mood
  // intersection, and surfaces "unknown" when bucket is omitted.
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
  const tail = selectOffsetTail(sorted, offset, limit, opts.bucket);
  const enriched = await enrich(tail, ctx, {
    ...(opts.bucket ? { filter: opts.bucket } : {}),
    prefetchedMetadata: metaMap,
  });
  if (enriched.partial) partial = true;
  const items = enriched.items.slice(0, limit);
  const sources = enriched.sources.slice(0, limit);
  const nextOffset = offset + scannedRowCount(tail, sources, limit);
  const cursor = nextOffset < sorted.length ? encodeOffsetCursor(nextOffset) : null;
  return { items, cursor, partial };
}

// Bucket: full tail so enrich's `filter` can prune sparse buckets. No-bucket: bounded window — every row survives enrich.
function selectOffsetTail(
  sorted: ActiveRow[],
  offset: number,
  limit: number,
  bucket: WatchlistBucket | undefined,
): ActiveRow[] {
  if (bucket) return sorted.slice(offset);
  return sorted.slice(offset, offset + limit * OVERSHOOT_FACTOR);
}

// V.WL1: advance past last *returned* row; underfill means tail exhausted → caller nulls the cursor.
function scannedRowCount(tail: ActiveRow[], returnedSources: ActiveRow[], limit: number): number {
  if (returnedSources.length < limit) return tail.length;
  const lastId = returnedSources[returnedSources.length - 1]!.id;
  const lastIdx = tail.findIndex((r) => r.id === lastId);
  return lastIdx >= 0 ? lastIdx + 1 : tail.length;
}

/**
 * Tonight section delegator. Implementation lives in `tonight/section.ts`
 * so cache state can co-locate with `invalidate(userId)` for the mutation
 * listener.
 */
export async function getTonightSection(ctx: MaybeRowContext): Promise<WatchlistSectionResponse> {
  return getTonightSectionImpl(asWatchlistContext(ctx));
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

/** Mood-cluster summary delegator. */
export async function getMoodSummary(ctx: MaybeRowContext): Promise<WatchlistMoodSummary> {
  const c = asWatchlistContext(ctx);
  return getMoodSummaryImpl(c);
}

export interface ListMoodItemsOptions {
  cursor?: string;
  limit?: number;
}

/**
 * Paginated rows for a specific mood. Reuses the keyset cursor pattern with
 * overshoot — the mood predicate is applied after the keyset slice so the
 * server can serve a stable page even when the predicate drops most rows.
 * Hops accumulate matched items across windows; underfilled hops do not
 * count against the empty-streak budget so a request keeps scanning while
 * it is making progress.
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

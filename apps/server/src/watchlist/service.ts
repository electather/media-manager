import type { ConsolaInstance } from "consola";
import { consola } from "consola";
import {
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
  listRows,
  loadProgressMap,
  listAllActiveRows,
  listActiveRowsKeyset,
  listAvailableCandidates,
  hasActiveRows,
  hasUserSeeded,
  encodeCursor,
  decodeCursor,
  decode,
  type AddItemResult,
  type Cursor,
  type GetArtworkFn,
  type MediaService,
  type MediaSource,
  type PipelineConfig,
  type SeedResult,
  type ToCanonicalRowFn,
} from "../media";

export type { AddItemResult, SeedResult };
import { getSummary as getMoodSummaryImpl } from "./moods/cluster";
import { getSection as getTonightSectionImpl } from "./tonight/section";
import { itemsSource, itemsCfg, toItemsParams } from "./sources/items";
import { moodItemsSource, moodItemsCfg, type MoodParams } from "./sources/mood-items";
import { toSourceContext } from "./sources/context";

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

/**
 * Run a watchlist section read through a `MediaSource`: decode the incoming
 * cursor against the source's declared mode (a bad/foreign/mode-mismatched
 * cursor → `null` → first page, V.CU1), list via the shared media pipeline, and
 * bridge the result onto the `WatchlistResponse` wire shape. The pipeline yields
 * public `CompactMediaItem`s (no `WatchlistItem` construction); active rows
 * always carry `addedAt`/`addedSource`, so the cast is sound until US-024
 * deletes `WatchlistItem` and the response widens to `CompactMediaItem`.
 */
async function readSection<P>(
  c: ResolvedWatchlistContext,
  source: MediaSource<P>,
  toCfg: (cursor: Cursor | null) => PipelineConfig<P>,
  rawCursor: string | undefined,
): Promise<WatchlistResponse> {
  const cursor = rawCursor ? decode(rawCursor, source.stages.cursorMode) : null;
  const page = await listRows(source, toCfg(cursor), toSourceContext(c));
  return { items: page.items as WatchlistItem[], cursor: page.cursor, partial: page.partial };
}

/**
 * Paginated list of watchlist items with sort + bucket + mood filters. Thin
 * envelope over the media read pipeline (design §S.1 / consolidation §H): the
 * `items` `MediaSource` supplies the raw rows + a `stages` declaration and
 * `media.listRows` owns enrich / classify / filter / sort / paginate / cursor.
 * `recent` + no filter rides the keyset window; every other read (a non-recent
 * metadata sort, or a bucket/mood filter) rides offset mode. When `bucket` is
 * omitted, every active row surfaces (V.WL2).
 */
export async function listItems(
  ctx: MaybeRowContext,
  opts: ListItemsOptions = {},
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  const params = toItemsParams({ ...opts, limit: clampLimit(opts.limit) });
  return readSection(c, itemsSource(params), (cursor) => itemsCfg(params, cursor), opts.cursor);
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
 * Paginated rows for a specific mood. Thin envelope over the media read
 * pipeline (design §S.3 / consolidation §H): the `mood-items` `MediaSource`
 * scans keyset windows, applies the mood predicate, and accumulates a full page
 * across windows (it owns the overshoot + empty-streak budget so a sparse mood
 * still fills a page); `media.listRows` owns enrich / sort / paginate / cursor.
 * A bad/foreign/mode-mismatched cursor decodes to `null` → first page (V.CU1).
 */
export async function listMoodItems(
  ctx: MaybeRowContext,
  moodId: MoodId,
  opts: ListMoodItemsOptions = {},
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  const params: MoodParams = { moodId, limit: clampLimit(opts.limit) };
  return readSection(c, moodItemsSource, (cursor) => moodItemsCfg(params, cursor), opts.cursor);
}

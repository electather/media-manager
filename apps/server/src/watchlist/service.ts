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
import { ArtworkService } from "../artwork";
import { toCanonicalRow, type CatalogService } from "../catalog";
import {
  classifyBucket,
  enrich,
  getMatchingServersCached,
  previewForClassify,
  type EnrichOptions,
  type GetArtworkFn,
  type MatchingServer,
  type MediaService,
  type ToCanonicalRowFn,
} from "../media";
import { emit, type EventName } from "../jobs/events";
import { WATCHLIST_EVENTS, watchlistItemAddedSchema, watchlistItemRemovedSchema } from "./events";
import { derive as deriveMoods } from "./moods/derive";
import { getSummary as getMoodSummaryImpl } from "./moods/cluster";
import { loadProgressMap } from "../media";
import { getSection as getTonightSectionImpl } from "./tonight/section";
import * as repo from "./repo";
import type { WatchlistRow } from "./repo";

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
  const cursor = opts.cursor ? repo.decodeCursor(opts.cursor) : undefined;
  let partial = false;

  // Seed only on the *first* page; cursor implies the user already has rows.
  if (!cursor && !(await repo.hasSeeded(c.userId))) {
    const peek = await repo.list(c.userId, { state: "active", limit: 1 });
    if (peek.length === 0) {
      const seedRes = await seedFromPlugins(c);
      partial = partial || seedRes.partial;
    }
  }

  const rows = await repo.listPage(c.userId, {
    limit,
    ...(cursor ? { cursor } : {}),
  });
  if (rows.length === 0) {
    return { items: [], cursor: null, partial };
  }
  const enriched = await enrich(rows, c);
  const last = rows[rows.length - 1]!;
  const nextCursor =
    rows.length < limit ? null : repo.encodeCursor({ addedAt: last.addedAt, id: last.id });
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

/**
 * Returns cheap aggregate counts for the header pips. Walks every active row
 * once with metadata + status + cached matching-server probes — NO artwork
 * dispatch, NO cold-fill — so a 1000-row watchlist costs one batch query
 * plus 1000 cache hits (after the first page warms the 30 s cache).
 */
// fallow-ignore-next-line complexity
export async function getCounts(ctx: MaybeRowContext): Promise<WatchlistCounts> {
  const c = asWatchlistContext(ctx);
  const rows = await repo.listAllActive(c.userId);
  if (rows.length === 0) {
    return { ready: 0, inProgress: 0, awaiting: 0, unavailable: 0, upcoming: 0, total: 0 };
  }

  const compositeIds = rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));

  const [statuses, metadata, progress] = await Promise.all([
    // fallow-ignore-next-line code-duplication
    c.mediaService.getStatusBatch(compositeIds).catch((err) => {
      c.log.warn("[watchlist:counts] getStatusBatch failed", err);
      return {} as Record<string, string>;
    }),
    c.catalog.getMetadataBatch(metadataKeys).catch((err) => {
      c.log.warn("[watchlist:counts] getMetadataBatch failed", err);
      return {} as Record<string, { year?: number; runtimeMinutes?: number }>;
    }),
    loadProgressMap(c),
  ]);

  const serverProbes = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(c.userId, c.mediaService, row.tmdbId, row.mediaType),
    ),
  );

  let ready = 0;
  let inProgress = 0;
  let awaiting = 0;
  let unavailable = 0;
  let upcoming = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers: MatchingServer[] = probe.status === "fulfilled" ? probe.value : [];
    const meta = (metadata as Record<string, { year?: number; runtimeMinutes?: number }>)[
      composite
    ];
    const preview = previewForClassify(
      meta,
      statuses[composite],
      servers,
      progress.map.get(composite),
    );
    const bucket = classifyBucket(preview);
    if (bucket === "ready") ready++;
    else if (bucket === "in-progress") inProgress++;
    else if (bucket === "awaiting") awaiting++;
    else if (bucket === "upcoming") upcoming++;
    else if (bucket === "unavailable") unavailable++;
  }

  return { ready, inProgress, awaiting, unavailable, upcoming, total: rows.length };
}

export interface AddItemResult {
  item: WatchlistItem;
  wasActive: boolean;
}

/** Idempotent: adds a brand-new row, reactivates a removed one, or no-ops on active. */
export async function addItem(
  key: WatchlistKey,
  source: WatchlistSource,
  ctx: MaybeRowContext,
): Promise<AddItemResult> {
  const c = asWatchlistContext(ctx);
  const now = Date.now();
  const result = await repo.upsertActive(c.userId, key, source, now);
  const [enriched] = (await enrich([result.row], c)).items;
  const fallback: WatchlistItem = {
    id: keyToId(key),
    tmdbId: key.tmdbId,
    mediaType: key.mediaType,
    title: `${key.mediaType === "tv" ? "Show" : "Movie"} ${key.tmdbId}`,
    addedAt: result.row.addedAt,
    addedSource: result.row.source,
  };
  const item = enriched ?? fallback;
  if (!result.wasActive) {
    await safeEmit(
      WATCHLIST_EVENTS.ITEM_ADDED,
      watchlistItemAddedSchema,
      {
        userId: c.userId,
        key: keyToId(key),
        source,
        createdAt: result.row.addedAt,
      },
      c.log,
    );
  }
  return { item, wasActive: result.wasActive };
}

/** Idempotent: 204-style. Active → removed, already-removed / never-existed → no-op. */
export async function removeItem(
  key: WatchlistKey,
  ctx: MaybeRowContext,
): Promise<{ removed: boolean }> {
  const c = asWatchlistContext(ctx);
  const now = Date.now();
  const result = await repo.softRemove(c.userId, key, now);
  if (result.removed) {
    await safeEmit(
      WATCHLIST_EVENTS.ITEM_REMOVED,
      watchlistItemRemovedSchema,
      {
        userId: c.userId,
        key: keyToId(key),
        removedAt: now,
      },
      c.log,
    );
  }
  return { removed: result.removed };
}

export interface SeedResult {
  added: number;
  partial: boolean;
}

/**
 * Pulls the plugin watchlist feed and bulk-inserts new items. Serializes
 * concurrent first-GETs via `trySeedLock` so only the winning caller fans
 * out to plugins; losers short-circuit with `added: 0`. On a plugin error
 * the lock is rolled back so the next GET retries.
 */
export async function seedFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  const c = asWatchlistContext(ctx);
  const now = Date.now();
  const wonLock = await repo.trySeedLock(c.userId, now);
  if (!wonLock) {
    // Another concurrent caller is doing the plugin fetch; nothing to do here.
    return { added: 0, partial: false };
  }
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (c.deadlineMs != null) opts.deadlineMs = c.deadlineMs;
    feed = await c.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    c.log.warn("[watchlist:seed] getWatchlistFeed threw", err);
    // Roll the lock back so the next GET retries the plugin call.
    await repo.clearSeedLock(c.userId).catch(() => {});
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await repo.allKnownKeys(c.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const added = await repo.bulkInsertIgnoreConflict(c.userId, fresh, "plugin", true, now);
  if (feed.partial) {
    // Don't keep the lock when the feed was incomplete — next GET should retry.
    await repo.clearSeedLock(c.userId).catch(() => {});
  }
  return { added, partial: feed.partial };
}

/**
 * Periodic merge for already-seeded users. Diffs the plugin feed against
 * `allKnownKeys` so removed (tombstoned) items never resurrect.
 */
export async function syncFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  const c = asWatchlistContext(ctx);
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (c.deadlineMs != null) opts.deadlineMs = c.deadlineMs;
    feed = await c.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    c.log.warn("[watchlist:sync] getWatchlistFeed threw", err);
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await repo.allKnownKeys(c.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const now = Date.now();
  // Sync-added rows are not initial-seed rows; flag false so future reporting
  // can distinguish cron-acquired items from the eager seed.
  const added = await repo.bulkInsertIgnoreConflict(c.userId, fresh, "plugin", false, now);
  return { added, partial: feed.partial };
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
  let candidates = await repo.listAvailableCandidates(c.userId, limit * 4);
  if (candidates.length === 0 && !(await repo.hasSeeded(c.userId))) {
    const seedRes = await seedFromPlugins(c);
    partial = partial || seedRes.partial;
    candidates = await repo.listAvailableCandidates(c.userId, limit * 4);
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
  const picked: WatchlistRow[] = [];
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
  return repo.hasActiveRows(userId);
}

async function safeEmit<T>(
  name: EventName,
  schema: Parameters<typeof emit<T>>[1],
  payload: T,
  log: ConsolaInstance,
): Promise<void> {
  try {
    await emit(name, schema, payload);
  } catch (err) {
    log.warn(`[watchlist:event] emit ${String(name)} failed`, err);
  }
}

/**
 * Probes a `watchlist@v1` entry for `{ tmdbId, mediaType }`. Plugins emit
 * either a flat object or `{ item: {...} }` envelope; tmdb id is found under
 * `ids.tmdb`, `ids.tmdb_id`, or a top-level `tmdbId`.
 */
// fallow-ignore-next-line complexity
function toWatchlistKey(value: unknown): WatchlistKey | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  const itemRaw = (outer.item ?? outer) as Record<string, unknown>;
  const tmdbId = extractTmdbId(itemRaw);
  if (!tmdbId) return null;
  // Plugins may return `episode`, `special`, or omit `type` entirely. Reject
  // anything that isn't a primary `movie` / `tv` / `show` so the row is
  // dropped rather than silently coerced into `tv` (which would produce
  // colliding ids in the canonical metadata table).
  const rawType = itemRaw.type;
  let mediaType: "movie" | "tv";
  if (rawType === "movie") {
    mediaType = "movie";
  } else if (rawType === "tv" || rawType === "show") {
    mediaType = "tv";
  } else {
    return null;
  }
  return { tmdbId, mediaType };
}

// fallow-ignore-next-line code-duplication
function extractTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ids = v.ids as Record<string, unknown> | undefined;
  if (ids && typeof ids.tmdb === "string") return ids.tmdb;
  if (ids && typeof ids.tmdb_id === "string") return ids.tmdb_id;
  if (typeof v.tmdbId === "string") return v.tmdbId;
  return null;
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
  a: WatchlistRow,
  b: WatchlistRow,
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
  const cursor = opts.cursor ? repo.decodeCursor(opts.cursor) : undefined;
  const fetchSize =
    opts.bucket || opts.mood ? Math.min(limit * OVERSHOOT_FACTOR, WATCHLIST_LIST_MAX_LIMIT) : limit;

  let scanCursor: repo.PageCursor | undefined = cursor ?? undefined;
  let collectedItems: WatchlistItem[] = [];
  let enrichPartial = false;
  let nextCursor: string | null = null;

  // fallow-ignore-next-line code-duplication
  for (let hop = 0; hop <= MAX_EMPTY_HOPS; hop++) {
    const rows = await repo.listPage(c.userId, {
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
            : repo.encodeCursor({ addedAt: lastReturned.addedAt, id: lastReturned.id });
      } else {
        nextCursor = exhausted
          ? null
          : repo.encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id });
      }
      break;
    }

    nextCursor = exhausted
      ? null
      : repo.encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id });
    if (exhausted) break;
    scanCursor = { addedAt: lastScanned.addedAt, id: lastScanned.id };
  }

  return { items: collectedItems, cursor: nextCursor, partial: enrichPartial };
}

async function filterByMood(
  rows: WatchlistRow[],
  ctx: ResolvedWatchlistContext,
  mood: MoodId,
): Promise<{
  rows: WatchlistRow[];
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
  const all = await repo.listAllActive(ctx.userId);
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
  // Advance cursor by the number of sorted rows actually scanned, not by the
  // returned slice length — when a bucket filter drops most of the window we
  // must skip past every scanned row or the next page repeats them (V.WL2).
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
  const rows = await repo.listPage(c.userId, { limit });
  if (rows.length === 0) return { items: [], partial: false };
  const enriched = await enrich(rows, c);
  return { items: enriched.items, partial: enriched.partial };
}

/** Mood-cluster summary delegator. */
export async function getMoodSummary(ctx: MaybeRowContext): Promise<WatchlistMoodSummary> {
  const c = asWatchlistContext(ctx);
  return getMoodSummaryImpl({ userId: c.userId, catalog: c.catalog, log: c.log });
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
  const cursor = opts.cursor ? repo.decodeCursor(opts.cursor) : undefined;
  const fetchSize = Math.min(limit * OVERSHOOT_FACTOR, WATCHLIST_LIST_MAX_LIMIT);

  let scanCursor: repo.PageCursor | undefined = cursor ?? undefined;
  const collectedItems: WatchlistItem[] = [];
  const collectedSources: WatchlistRow[] = [];
  let enrichPartial = false;
  let nextCursor: string | null = null;
  let emptyStreak = 0;

  // fallow-ignore-next-line code-duplication
  for (let hop = 0; hop < MAX_MOOD_HOPS; hop++) {
    const rows = await repo.listPage(c.userId, {
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
          : repo.encodeCursor({ addedAt: last.addedAt, id: last.id });
      break;
    }
    if (exhausted) {
      nextCursor = null;
      break;
    }
    if (emptyStreak > MAX_EMPTY_HOPS) {
      nextCursor =
        collectedItems.length > 0
          ? repo.encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id })
          : null;
      break;
    }
    scanCursor = { addedAt: lastScanned.addedAt, id: lastScanned.id };
  }

  return { items: collectedItems, cursor: nextCursor, partial: enrichPartial };
}

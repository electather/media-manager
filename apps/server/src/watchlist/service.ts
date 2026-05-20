import type { ConsolaInstance } from "consola";
import { consola } from "consola";
import {
  keyToId,
  WATCHLIST_LIST_DEFAULT_LIMIT,
  WATCHLIST_LIST_MAX_LIMIT,
  type WatchlistCounts,
  type WatchlistItem,
  type WatchlistKey,
  type WatchlistListFilter,
  type WatchlistResponse,
  type WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import type { CatalogService } from "../catalog";
import type { MatchingServer, MediaService } from "../media";
import { emit, type EventName } from "../jobs/events";
import { getMatchingServersCached } from "./availability-cache";
import { classifyBucket, previewForClassify, type WatchlistBucket } from "./classify";
import { WATCHLIST_EVENTS, watchlistItemAddedSchema, watchlistItemRemovedSchema } from "./events";
import { enrich } from "./enrich";
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

interface MaybeRowContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log?: ConsolaInstance;
  logger?: ConsolaInstance;
}

function asWatchlistContext(ctx: MaybeRowContext): WatchlistContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    deadlineMs: ctx.deadlineMs,
    log: ctx.log ?? ctx.logger ?? consola,
  };
}

export interface GetItemsOptions {
  /** Opaque keyset cursor from a previous response. Omit on the first page. */
  cursor?: string;
  /** Page size cap. Defaults to 60, hard-capped at 200 to match the wire schema. */
  limit?: number;
  /**
   * Optional bucket pre-filter. When set, rows whose pre-classified bucket
   * doesn't match are dropped before artwork hydration — the most expensive
   * part of enrich.
   */
  filter?: WatchlistListFilter;
}

/**
 * Keyset-paginated read of the user's active watchlist. First page (no
 * cursor) triggers a plugin seed when the user has never been seeded. With
 * `filter`, the server pre-classifies each row using the cheap signals and
 * drops rows the bucket would otherwise hide — matches design §H goal of
 * "skip enrichment for buckets the user is not viewing".
 */
// fallow-ignore-next-line complexity
export async function getItems(
  ctx: MaybeRowContext,
  opts: GetItemsOptions = {},
): Promise<WatchlistResponse> {
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

  // When the bucket filter drops most rows we'd hand back a short page with
  // a cursor that re-fires another round-trip. Overshoot a bounded factor
  // (3x) so the common case of a heavy filter still returns close to `limit`
  // items in one call.
  //
  // Even with the overshoot a window of `fetchSize` rows can land entirely
  // outside the requested bucket — returning `{ items: [], cursor: <real> }`
  // would force the client into an empty "Load more" tap loop. We retry up
  // to MAX_EMPTY_HOPS times in-handler, advancing the cursor to the last
  // scanned row each time, so the client only sees an empty response when
  // the entire tail is filtered out.
  const fetchSize = opts.filter ? Math.min(limit * 3, WATCHLIST_LIST_MAX_LIMIT) : limit;
  const MAX_EMPTY_HOPS = opts.filter ? 2 : 0;

  let scanCursor: repo.PageCursor | undefined = cursor ?? undefined;
  let collectedItems: WatchlistItem[] = [];
  let enrichPartial = false;
  let nextCursor: string | null = null;

  for (let hop = 0; hop <= MAX_EMPTY_HOPS; hop++) {
    const rows = await repo.listPage(c.userId, {
      limit: fetchSize,
      ...(scanCursor ? { cursor: scanCursor } : {}),
    });
    if (rows.length === 0) {
      nextCursor = null;
      break;
    }
    const enriched = await enrich(rows, c, opts.filter ? { filter: opts.filter } : {});
    if (enriched.partial) enrichPartial = true;
    collectedItems = enriched.items.slice(0, limit);

    const lastScanned = rows[rows.length - 1]!;
    const exhausted = rows.length < fetchSize;
    nextCursor = exhausted
      ? null
      : repo.encodeCursor({ addedAt: lastScanned.addedAt, id: lastScanned.id });

    // Either we have something to return, or there's nothing more to scan.
    if (collectedItems.length > 0 || exhausted) break;
    scanCursor = { addedAt: lastScanned.addedAt, id: lastScanned.id };
  }

  return {
    items: collectedItems,
    cursor: nextCursor,
    partial: partial || enrichPartial,
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
    return { ready: 0, inProgress: 0, awaiting: 0, upcoming: 0, total: 0 };
  }

  const compositeIds = rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));

  const [statuses, metadata] = await Promise.all([
    c.mediaService.getStatusBatch(compositeIds).catch((err) => {
      c.log.warn("[watchlist:counts] getStatusBatch failed", err);
      return {} as Record<string, string>;
    }),
    c.catalog.getMetadataBatch(metadataKeys).catch((err) => {
      c.log.warn("[watchlist:counts] getMetadataBatch failed", err);
      return {} as Record<string, { year?: number; runtimeMinutes?: number }>;
    }),
  ]);

  const serverProbes = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(c.userId, c.mediaService, row.tmdbId, row.mediaType),
    ),
  );

  let ready = 0;
  let awaiting = 0;
  let upcoming = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers: MatchingServer[] = probe.status === "fulfilled" ? probe.value : [];
    const meta = (metadata as Record<string, { year?: number; runtimeMinutes?: number }>)[
      composite
    ];
    const preview = previewForClassify(meta, statuses[composite], servers);
    const bucket: WatchlistBucket = classifyBucket(preview);
    if (bucket === "ready") ready++;
    else if (bucket === "awaiting") awaiting++;
    else if (bucket === "upcoming") upcoming++;
  }

  // `inProgress` is a strict subset of `ready` reserved for rows whose
  // underlying media has an active watch position. `mediaService.getProgress`
  // is a host-side stub in v1 (no plugin capability covers per-row progress),
  // so we report 0 here. When the progress aggregator lands, the count
  // pulls from the same probe without changing the wire contract.
  return { ready, inProgress: 0, awaiting, upcoming, total: rows.length };
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

function extractTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ids = v.ids as Record<string, unknown> | undefined;
  if (ids && typeof ids.tmdb === "string") return ids.tmdb;
  if (ids && typeof ids.tmdb_id === "string") return ids.tmdb_id;
  if (typeof v.tmdbId === "string") return v.tmdbId;
  return null;
}

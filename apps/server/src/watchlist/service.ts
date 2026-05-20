import type { ConsolaInstance } from "consola";
import { consola } from "consola";
import {
  keyToId,
  type WatchlistItem,
  type WatchlistKey,
  type WatchlistResponse,
  type WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import type { CatalogService } from "../catalog";
import type { MediaService } from "../media";
import { emit, type EventName } from "../jobs/events";
import {
  WATCHLIST_EVENTS,
  watchlistItemAddedSchema,
  watchlistItemRemovedSchema,
} from "./events";
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

/**
 * Returns the user's active watchlist. First-call seeding triggers eagerly
 * when the user has not been seeded; the seed is best-effort and threads
 * `partial: true` when the plugin throws.
 */
export async function getItems(ctx: MaybeRowContext): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  let partial = false;
  if (!(await repo.hasSeeded(c.userId))) {
    const seedRes = await seedFromPlugins(c);
    partial = partial || seedRes.partial;
  }
  const rows = await repo.list(c.userId, { state: "active" });
  const enriched = await enrich(rows, c);
  return { items: enriched.items, partial: partial || enriched.partial };
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
    await safeEmit(WATCHLIST_EVENTS.ITEM_ADDED, watchlistItemAddedSchema, {
      userId: c.userId,
      key: keyToId(key),
      source,
      createdAt: result.row.addedAt,
    }, c.log);
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
    await safeEmit(WATCHLIST_EVENTS.ITEM_REMOVED, watchlistItemRemovedSchema, {
      userId: c.userId,
      key: keyToId(key),
      removedAt: now,
    }, c.log);
  }
  return { removed: result.removed };
}

export interface SeedResult {
  added: number;
  partial: boolean;
}

/**
 * Pulls the plugin watchlist feed and bulk-inserts new items. On any plugin
 * error, returns `partial: true` and leaves `user_watchlist_seed` unset so a
 * later GET retries. Plain success path marks the user as seeded.
 */
export async function seedFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  const c = asWatchlistContext(ctx);
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (c.deadlineMs != null) opts.deadlineMs = c.deadlineMs;
    feed = await c.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    c.log.warn("[watchlist:seed] getWatchlistFeed threw", err);
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await repo.allKnownKeys(c.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const now = Date.now();
  const added = await repo.bulkInsertIgnoreConflict(c.userId, fresh, "plugin", true, now);
  if (!feed.partial) {
    await repo.markSeeded(c.userId, now);
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
  const added = await repo.bulkInsertIgnoreConflict(c.userId, fresh, "plugin", true, now);
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
  if (candidates.length === 0) return { items: [], partial };

  const picked: WatchlistRow[] = [];
  for (const row of candidates) {
    if (picked.length >= limit) break;
    const servers = await c.mediaService
      .getMatchingServers(row.tmdbId, row.mediaType)
      .catch(() => []);
    if (servers.length > 0) picked.push(row);
  }
  if (picked.length === 0) return { items: [], partial };

  const enriched = await enrich(picked, c);
  return { items: enriched.items, partial: partial || enriched.partial };
}

export async function hasAny(userId: string): Promise<boolean> {
  return repo.hasAny(userId);
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
  const type = itemRaw.type === "movie" ? "movie" : "tv";
  return { tmdbId, mediaType: type };
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

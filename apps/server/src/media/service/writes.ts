import type { ConsolaInstance } from "consola";
import { z } from "zod";
import {
  keyToId,
  WATCHLIST_SOURCES,
  type WatchlistItem,
  type WatchlistKey,
  type WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import { emit, type EventName } from "../../jobs/events";
import { enrich, type MediaEnrichContext } from "../enrich";
import { extractTmdbId } from "../progress";
import { allKnownKeys } from "../repo/reads";
import { clearSeedLock, trySeedLock } from "../repo/seed";
import { bulkInsertActiveRows, softRemoveRow, upsertActiveRow } from "../repo/writes";

/**
 * Cross-module events emitted by media's `watchlist_items` writes. Media owns
 * the table writes (design §M.2), so the events those writes produce live with
 * the producer. Consumers subscribe through the `../media` barrel — never from
 * this file directly. The watchlist module's `on-watchlist-mutation` handler is
 * the sole subscriber (it invalidates the Tonight / mood / counts caches).
 *
 * These are deliberately NOT declared in `media/events.ts`: the boot-time
 * handler-coverage scan pairs each `<MODULE>_EVENTS` const in `media/events.ts`
 * with an `on(...)` handler under a fixed set of module `jobs` dirs, and this
 * event's handler lives in `watchlist/jobs/` — outside that scan.
 */
export const WATCHLIST_EVENTS = {
  ITEM_ADDED: "watchlist.itemAdded" as EventName,
  ITEM_REMOVED: "watchlist.itemRemoved" as EventName,
} as const;

export const watchlistItemAddedSchema = z
  .object({
    userId: z.string(),
    key: z.string(),
    source: z.enum(WATCHLIST_SOURCES),
    createdAt: z.number(),
  })
  .strict();
export type WatchlistItemAddedPayload = z.infer<typeof watchlistItemAddedSchema>;

export const watchlistItemRemovedSchema = z
  .object({
    userId: z.string(),
    key: z.string(),
    removedAt: z.number(),
  })
  .strict();
export type WatchlistItemRemovedPayload = z.infer<typeof watchlistItemRemovedSchema>;

export interface AddItemResult {
  item: WatchlistItem;
  wasActive: boolean;
}

/** Idempotent: adds a brand-new row, reactivates a removed one, or no-ops on active. */
export async function addItem(
  key: WatchlistKey,
  source: WatchlistSource,
  ctx: MediaEnrichContext,
): Promise<AddItemResult> {
  const now = Date.now();
  const result = await upsertActiveRow(ctx.userId, key, source, now);
  const [enriched] = (await enrich([result.row], ctx)).items;
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
        userId: ctx.userId,
        key: keyToId(key),
        source,
        createdAt: result.row.addedAt,
      },
      ctx.log,
    );
  }
  return { item, wasActive: result.wasActive };
}

/** Idempotent: 204-style. Active → removed, already-removed / never-existed → no-op. */
export async function removeItem(
  key: WatchlistKey,
  ctx: Pick<MediaEnrichContext, "userId" | "log">,
): Promise<{ removed: boolean }> {
  const now = Date.now();
  const result = await softRemoveRow(ctx.userId, key, now);
  if (result.removed) {
    await safeEmit(
      WATCHLIST_EVENTS.ITEM_REMOVED,
      watchlistItemRemovedSchema,
      {
        userId: ctx.userId,
        key: keyToId(key),
        removedAt: now,
      },
      ctx.log,
    );
  }
  return { removed: result.removed };
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

export interface SeedResult {
  added: number;
  partial: boolean;
}

/** Minimal media surface the plugin seed/sync writes need: the watchlist feed. */
interface WatchlistFeedService {
  getWatchlistFeed(opts?: { deadlineMs?: number }): Promise<{ items: unknown[]; partial: boolean }>;
}

/**
 * Resolved per-request context for the plugin seed/sync writes. Like the other
 * media `watchlist_items` writes, these take an already-resolved context — the
 * watchlist wrapper and the sync job build it — so media never touches the
 * watchlist module's context resolution.
 */
export interface SeedSyncContext {
  userId: string;
  mediaService: WatchlistFeedService;
  log: ConsolaInstance;
  deadlineMs?: number;
}

/**
 * Pulls the plugin watchlist feed and bulk-inserts new items. Serializes
 * concurrent first-GETs via `trySeedLock` so only the winning caller fans
 * out to plugins; losers short-circuit with `added: 0`. On a plugin error
 * the lock is rolled back so the next GET retries.
 */
export async function seedFromPlugins(ctx: SeedSyncContext): Promise<SeedResult> {
  const now = Date.now();
  const wonLock = await trySeedLock(ctx.userId, now);
  if (!wonLock) {
    // Another concurrent caller is doing the plugin fetch; nothing to do here.
    return { added: 0, partial: false };
  }
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (ctx.deadlineMs != null) opts.deadlineMs = ctx.deadlineMs;
    feed = await ctx.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    ctx.log.warn("[watchlist:seed] getWatchlistFeed threw", err);
    // Roll the lock back so the next GET retries the plugin call.
    await clearSeedLock(ctx.userId).catch(() => {});
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await allKnownKeys(ctx.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const added = await bulkInsertActiveRows(ctx.userId, fresh, "plugin", true, now);
  if (feed.partial) {
    // Don't keep the lock when the feed was incomplete — next GET should retry.
    await clearSeedLock(ctx.userId).catch(() => {});
  }
  return { added, partial: feed.partial };
}

/**
 * Periodic merge for already-seeded users. Diffs the plugin feed against
 * `allKnownKeys` so removed (tombstoned) items never resurrect.
 */
export async function syncFromPlugins(ctx: SeedSyncContext): Promise<SeedResult> {
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (ctx.deadlineMs != null) opts.deadlineMs = ctx.deadlineMs;
    feed = await ctx.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    ctx.log.warn("[watchlist:sync] getWatchlistFeed threw", err);
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await allKnownKeys(ctx.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const now = Date.now();
  // Sync-added rows are not initial-seed rows; flag false so future reporting
  // can distinguish cron-acquired items from the eager seed.
  const added = await bulkInsertActiveRows(ctx.userId, fresh, "plugin", false, now);
  return { added, partial: feed.partial };
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

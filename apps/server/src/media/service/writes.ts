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
import { softRemoveRow, upsertActiveRow } from "../repo/writes";

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

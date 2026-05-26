import type { ConsolaInstance } from "consola";
import {
  keyToId,
  type WatchlistItem,
  type WatchlistKey,
  type WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import { emit, type EventName } from "../../jobs/events";
import { enrich, softRemoveRow, upsertActiveRow } from "../../media";
import { WATCHLIST_EVENTS, watchlistItemAddedSchema, watchlistItemRemovedSchema } from "../events";
import { asWatchlistContext, type MaybeRowContext } from "./context";

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
  const result = await upsertActiveRow(c.userId, key, source, now);
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

/** Idempotent: active rows are removed, while missing or already-removed rows no-op. */
export async function removeItem(
  key: WatchlistKey,
  ctx: MaybeRowContext,
): Promise<{ removed: boolean }> {
  const c = asWatchlistContext(ctx);
  const now = Date.now();
  const result = await softRemoveRow(c.userId, key, now);
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

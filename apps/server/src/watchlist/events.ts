import { z } from "zod";
import { WATCHLIST_SOURCES } from "@ent-mcp/shared/watchlist";
import type { EventName } from "../jobs/events";

/**
 * Cross-module events emitted by `watchlist/`. The boundaries test asserts
 * each value is cast to `EventName` and that the `<MODULE>_EVENTS` shape
 * holds, so the brand cast is required here.
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

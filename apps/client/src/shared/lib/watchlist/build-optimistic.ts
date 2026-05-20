import type { AddWatchlistRequest, WatchlistItem } from "@ent-mcp/shared/watchlist";
import { keyToId } from "@ent-mcp/shared/watchlist";

/**
 * Builds an optimistic `WatchlistItem` from the add request plus whatever
 * partial metadata the caller already has on screen (search result card,
 * recommendation tile, etc). Stamps `addedAt` with the current wall-clock so
 * `recently_added` sorts the new row first; falls back to a placeholder
 * title when the caller has nothing to seed with.
 */
export function buildOptimistic(
  request: AddWatchlistRequest,
  seed: Partial<WatchlistItem> = {},
): WatchlistItem {
  const id = keyToId({ tmdbId: request.tmdbId, mediaType: request.mediaType });
  const base: WatchlistItem = {
    ...seed,
    id,
    tmdbId: request.tmdbId,
    mediaType: request.mediaType,
    title: seed.title ?? `${request.mediaType === "tv" ? "Show" : "Movie"} ${request.tmdbId}`,
    addedAt: Date.now(),
    addedSource: request.source ?? "manual",
  };
  return base;
}

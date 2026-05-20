import { useCallback } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { WatchlistItem, WatchlistUserSource } from "@ent-mcp/shared/watchlist";
import { useAddToWatchlist } from "./use-add-to-watchlist";
import { useRemoveFromWatchlist } from "./use-remove-from-watchlist";
import { useWatchlistIdSet } from "./use-watchlist-id-set";

interface ToggleOptions {
  source?: WatchlistUserSource;
}

/**
 * Returns a stable `toggle(item)` callback that flips an item's watchlist
 * state. Cross-feature surfaces (home cards, search rows) call this without
 * needing to know whether the item is currently saved.
 */
export function useToggleWatchlist({ source = "manual" }: ToggleOptions = {}) {
  const ids = useWatchlistIdSet();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  return useCallback(
    (item: CompactMediaItem) => {
      if (ids.has(item.id)) {
        remove.mutate({ tmdbId: item.tmdbId, mediaType: item.mediaType });
        return;
      }
      const seed: Partial<WatchlistItem> = {
        id: item.id,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
      };
      if (item.year != null) seed.year = item.year;
      if (item.poster) seed.poster = item.poster;
      if (item.backdrop) seed.backdrop = item.backdrop;
      if (item.genres && item.genres.length > 0) seed.genres = item.genres;
      add.mutate({
        request: { tmdbId: item.tmdbId, mediaType: item.mediaType, source },
        seed,
      });
    },
    [ids, add, remove, source],
  );
}

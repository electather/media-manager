import { useCallback, useLayoutEffect, useRef } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { WatchlistItem, WatchlistUserSource } from "@ent-mcp/shared/watchlist";
import { useAddToWatchlist } from "./use-add-to-watchlist";
import { useRemoveFromWatchlist } from "./use-remove-from-watchlist";
import { useWatchlistIdSet } from "./use-watchlist-id-set";

interface ToggleOptions {
  source?: WatchlistUserSource;
}

/**
 * Returns a referentially stable `toggle(item)` callback that flips an
 * item's watchlist state. Cross-feature surfaces (home cards, search rows)
 * call this without needing to know whether the item is currently saved.
 *
 * Stability matters: this callback is forwarded to memoised `<Card>`s in
 * the home feed. The mutation result objects from `useMutation` are NOT
 * referentially stable across renders, so we capture the latest `ids` set
 * and mutation objects via refs and depend only on `source` for the
 * `useCallback` cache.
 */
export function useToggleWatchlist({ source = "manual" }: ToggleOptions = {}) {
  const ids = useWatchlistIdSet();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const idsRef = useRef(ids);
  const addRef = useRef(add);
  const removeRef = useRef(remove);
  // Latest-ref sync: runs every render (no dep array on purpose) so `toggle`
  // can read current state without being invalidated on every mutation cycle.
  useLayoutEffect(() => {
    idsRef.current = ids;
    addRef.current = add;
    removeRef.current = remove;
  });
  return useCallback(
    (item: CompactMediaItem) => {
      if (idsRef.current.has(item.id)) {
        removeRef.current.mutate({ tmdbId: item.tmdbId, mediaType: item.mediaType });
        return;
      }
      const seed: Partial<WatchlistItem> = {
        id: item.id,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
      };
      // fallow-ignore-next-line code-duplication
      if (item.year != null) seed.year = item.year;
      if (item.poster) seed.poster = item.poster;
      if (item.backdrop) seed.backdrop = item.backdrop;
      if (item.genres && item.genres.length > 0) seed.genres = item.genres;
      addRef.current.mutate({
        request: { tmdbId: item.tmdbId, mediaType: item.mediaType, source },
        seed,
      });
    },
    [source],
  );
}

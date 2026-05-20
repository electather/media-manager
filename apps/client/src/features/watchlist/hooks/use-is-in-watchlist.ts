import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

/**
 * Reactive membership check against the LOADED pages of the default
 * (unfiltered) watchlist. With v2 keyset pagination this is best-effort:
 * items on pages the user has not scrolled past read as `false`. Surfaces
 * (home cards, search rows) that toggle off this flag accept the trade-off
 * because the server's `addItem` is idempotent — a stray "add" on an item
 * the user already saved is a no-op rather than a duplicate.
 *
 * Uses `useSyncExternalStore` against the React Query cache so a write from
 * `useAddToWatchlist` / `useRemoveFromWatchlist` immediately re-renders
 * every subscriber.
 */
export function useIsInWatchlist(id: string): boolean {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => {
      if (!id) return false;
      const data = qc.getQueryData<WatchlistPages>(watchlistKeys.list());
      if (!data) return false;
      return data.pages.some((p) => p.items.some((i) => i.id === id));
    },
    () => false,
  );
}

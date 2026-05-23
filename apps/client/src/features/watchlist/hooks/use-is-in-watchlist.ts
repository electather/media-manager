import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { watchlistKeys } from "../lib/query-keys";

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

const LIST_KEY = watchlistKeys.list();

/**
 * Reactive membership check against the LOADED pages of the default
 * (unfiltered) watchlist. With v2 keyset pagination this is best-effort:
 * items on pages the user has not scrolled past read as `false`. Surfaces
 * (home cards, search rows) that toggle off this flag accept the trade-off
 * because the server's `addItem` is idempotent — a stray "add" on an item
 * the user already saved is a no-op rather than a duplicate.
 *
 * Subscribes to the React Query cache and returns the raw `pages` reference
 * as the snapshot. React's `Object.is` bail-out then skips the per-row scan
 * on cache events for keys we don't care about (notifications, home, etc.);
 * the boolean is derived once in the render body off whatever pages came
 * back this tick.
 */
// fallow-ignore-next-line complexity
export function useIsInWatchlist(id: string): boolean {
  const qc = useQueryClient();
  const pages = useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => qc.getQueryData<WatchlistPages>(LIST_KEY),
    () => undefined,
  );
  if (!id || !pages) return false;
  for (const page of pages.pages) {
    for (const item of page.items) if (item.id === id) return true;
  }
  return false;
}

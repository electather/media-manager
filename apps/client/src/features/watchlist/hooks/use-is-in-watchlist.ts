import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { WatchlistItem, WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { watchlistKeys } from "../lib/query-keys";

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

/**
 * Reactive membership check across every loaded watchlist sub-cache (items,
 * mood items, tonight, recently). With the per-section split there is no
 * single canonical list; any section that already loaded the item is enough
 * to flip this on. Surfaces (home cards, search rows) that toggle off this
 * flag accept best-effort: an item on a strip the user has not scrolled to
 * reads `false`, and the server's idempotent `addItem` absorbs the stray
 * "add" rather than producing a duplicate.
 */
export function useIsInWatchlist(id: string): boolean {
  const qc = useQueryClient();
  // Snapshot derives from `dataUpdatedAt` across every matching sub-cache so
  // mutation events (setQueryData, refetch, invalidate-refresh) advance the
  // value even when query-cache size is unchanged.
  const snapshotVersion = useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => {
      let v = 0;
      const queries = qc.getQueryCache().findAll({ queryKey: watchlistKeys.root });
      for (const q of queries) v += q.state.dataUpdatedAt;
      return v;
    },
    () => 0,
  );
  if (!id) return false;
  void snapshotVersion;
  const queries = qc.getQueryCache().findAll({ queryKey: watchlistKeys.root });
  for (const q of queries) {
    if (isWatchlistItemMatch(q.state.data, id)) return true;
  }
  return false;
}

function isWatchlistItemMatch(data: unknown, id: string): boolean {
  if (!data || typeof data !== "object") return false;
  // Infinite-query shape: { pages: WatchlistResponse[] }
  if ("pages" in data) {
    const pages = (data as WatchlistPages).pages;
    for (const page of pages) {
      if (page.items.some((it: WatchlistItem) => it.id === id)) return true;
    }
    return false;
  }
  // Section-query shape: { items: WatchlistItem[] }
  if ("items" in data) {
    const items = (data as { items: WatchlistItem[] }).items;
    return items.some((it) => it.id === id);
  }
  return false;
}

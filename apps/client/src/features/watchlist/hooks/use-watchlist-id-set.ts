import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { watchlistKeys } from "../lib/query-keys";

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Composite-id snapshot for cross-feature consumers (home feed, search
 * results, etc). Reads from the LOADED pages of the default watchlist
 * cache only — does not trigger its own fetch. Surfaces that read this set
 * before the watchlist has been visited get an empty set and rely on
 * server-side idempotency to absorb add-when-already-saved cases.
 */
export function useWatchlistIdSet(): ReadonlySet<string> {
  const qc = useQueryClient();
  const pages = useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => qc.getQueryData<WatchlistPages>(watchlistKeys.list()),
    () => undefined,
  );
  return useMemo(() => {
    if (!pages) return EMPTY_SET;
    const out = new Set<string>();
    for (const page of pages.pages) {
      for (const item of page.items) out.add(item.id);
    }
    return out;
  }, [pages]);
}

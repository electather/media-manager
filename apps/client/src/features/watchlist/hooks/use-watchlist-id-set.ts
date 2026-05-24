import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type { WatchlistItem, WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { watchlistKeys } from "../lib/query-keys";

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Composite-id snapshot for cross-feature consumers. Walks every loaded
 * watchlist sub-cache and unions the ids the user has seen. Best-effort:
 * surfaces that read this set before any section loads get an empty set
 * and rely on server-side idempotency to absorb add-when-already-saved.
 */
export function useWatchlistIdSet(): ReadonlySet<string> {
  const qc = useQueryClient();
  const version = useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => qc.getQueryCache().getAll().length,
    () => 0,
  );
  return useMemo(() => {
    void version;
    const queries = qc.getQueryCache().findAll({ queryKey: watchlistKeys.root });
    if (queries.length === 0) return EMPTY_SET;
    const out = new Set<string>();
    for (const q of queries) {
      collectIds(q.state.data, out);
    }
    return out;
  }, [qc, version]);
}

// fallow-ignore-next-line complexity
function collectIds(data: unknown, out: Set<string>): void {
  if (!data || typeof data !== "object") return;
  if ("pages" in data) {
    const pages = (data as WatchlistPages).pages;
    for (const page of pages) for (const it of page.items as WatchlistItem[]) out.add(it.id);
    return;
  }
  if ("items" in data) {
    const items = (data as { items: WatchlistItem[] }).items;
    for (const it of items) out.add(it.id);
  }
}

import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type { CompactMediaItem, Page } from "@ent-mcp/shared/media";
import { mediaKeys } from "./query-keys";

/** The source id of the canonical watchlist user-list (the unfiltered all-items feed). */
export const WATCHLIST_ITEMS_SOURCE_ID = "watchlist-items" as const;

/**
 * The watchlist membership sub-key (#514). Scopes the id snapshot to the
 * `watchlist-items` source caches ONLY — NOT all of `mediaKeys.root`, which now
 * also spans home rows (recommendations, trending, …) whose items are not on the
 * watchlist. Prefix-matching covers every `sort` / `bucket` / `mood` / `limit`
 * combination of the list.
 */
const WATCHLIST_ITEMS_PREFIX = [...mediaKeys.root, "source", WATCHLIST_ITEMS_SOURCE_ID] as const;

type MediaPages = InfiniteData<Page, string | undefined>;

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Composite-id snapshot for cross-feature consumers, scoped to the watchlist
 * user-list (#514). Walks every loaded `watchlist-items` sub-cache and unions
 * the ids the user has seen. Best-effort: surfaces that read this set before any
 * page loads get an empty set and rely on the server's idempotent `addItem` to
 * absorb add-when-already-saved.
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
    const queries = qc.getQueryCache().findAll({ queryKey: WATCHLIST_ITEMS_PREFIX });
    if (queries.length === 0) return EMPTY_SET;
    const out = new Set<string>();
    for (const q of queries) collectIds(q.state.data, out);
    return out;
  }, [qc, version]);
}

/**
 * Reactive membership check across every loaded `watchlist-items` sub-cache
 * (#514). The snapshot derives from `dataUpdatedAt` so mutation events
 * (setQueryData, refetch, invalidate-refresh) advance the value even when the
 * cache size is unchanged.
 */
export function useIsInWatchlist(id: string): boolean {
  const qc = useQueryClient();
  const snapshotVersion = useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => {
      let v = 0;
      for (const q of qc.getQueryCache().findAll({ queryKey: WATCHLIST_ITEMS_PREFIX })) {
        v += q.state.dataUpdatedAt;
      }
      return v;
    },
    () => 0,
  );
  if (!id) return false;
  void snapshotVersion;
  for (const q of qc.getQueryCache().findAll({ queryKey: WATCHLIST_ITEMS_PREFIX })) {
    if (matchesId(q.state.data, id)) return true;
  }
  return false;
}

// fallow-ignore-next-line complexity
function collectIds(data: unknown, out: Set<string>): void {
  if (!data || typeof data !== "object") return;
  if ("pages" in data) {
    for (const page of (data as MediaPages).pages) {
      for (const it of page.items) out.add(it.id);
    }
    return;
  }
  if ("items" in data) {
    for (const it of (data as { items: CompactMediaItem[] }).items) out.add(it.id);
  }
}

// fallow-ignore-next-line complexity
function matchesId(data: unknown, id: string): boolean {
  if (!data || typeof data !== "object") return false;
  if ("pages" in data) {
    return (data as MediaPages).pages.some((page) => page.items.some((it) => it.id === id));
  }
  if ("items" in data) {
    return (data as { items: CompactMediaItem[] }).items.some((it) => it.id === id);
  }
  return false;
}

import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type { CompactMediaItem, MediaSourceId, Page } from "@nama/shared/media";
import { mediaKeys } from "./query-keys";

/** The source id of the canonical watchlist user-list (the unfiltered all-items feed). */
export const WATCHLIST_ITEMS_SOURCE_ID = "watchlist-items" as const;

/**
 * Source ids guaranteed on-watchlist (#514). Scoped to these caches, not all `mediaKeys.root`
 * (which includes home rows: recommendations, trending, etc. — not watchlist items).
 * Without them, items from mood/tonight/recently read as "not on watchlist" in peek modal.
 */
const WATCHLIST_ORIGIN_SOURCE_IDS: readonly MediaSourceId[] = [
  WATCHLIST_ITEMS_SOURCE_ID,
  "watchlist-mood-items",
  "watchlist-tonight",
  "watchlist-recently",
  "yourWatchlist",
];

/** Every loaded query sitting under a watchlist-origin source prefix. */
function watchlistOriginQueries(qc: QueryClient) {
  return WATCHLIST_ORIGIN_SOURCE_IDS.flatMap((sourceId) =>
    qc.getQueryCache().findAll({ queryKey: [...mediaKeys.root, "source", sourceId] }),
  );
}

type MediaPages = InfiniteData<Page, string | undefined>;

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Composite-id snapshot, scoped to watchlist-origin sources (#514). Best-effort:
 * pre-page-load reads get empty set; server's idempotent `addItem` absorbs add-when-already-saved.
 */
/**
 * Reactive version counter summing `dataUpdatedAt` over watchlist-origin queries only,
 * so it advances when this set changes, not on unrelated queries (home rows, detail fetches).
 */
function useWatchlistOriginVersion(qc: QueryClient): number {
  return useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    () => {
      let v = 0;
      for (const q of watchlistOriginQueries(qc)) v += q.state.dataUpdatedAt;
      return v;
    },
    () => 0,
  );
}

export function useWatchlistIdSet(): ReadonlySet<string> {
  const qc = useQueryClient();
  const version = useWatchlistOriginVersion(qc);
  return useMemo(() => {
    void version;
    const queries = watchlistOriginQueries(qc);
    if (queries.length === 0) return EMPTY_SET;
    const out = new Set<string>();
    for (const q of queries) collectIds(q.state.data, out);
    return out;
  }, [qc, version]);
}

/**
 * Reactive membership check across watchlist-origin caches (#514).
 * Snapshot from `dataUpdatedAt` so mutations advance it even if cache size unchanged.
 */
export function useIsInWatchlist(id: string): boolean {
  const qc = useQueryClient();
  const snapshotVersion = useWatchlistOriginVersion(qc);
  if (!id) return false;
  void snapshotVersion;
  for (const q of watchlistOriginQueries(qc)) {
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

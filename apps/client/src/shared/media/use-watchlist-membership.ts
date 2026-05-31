import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type { CompactMediaItem, MediaSourceId, Page } from "@ent-mcp/shared/media";
import { mediaKeys } from "./query-keys";

/** The source id of the canonical watchlist user-list (the unfiltered all-items feed). */
export const WATCHLIST_ITEMS_SOURCE_ID = "watchlist-items" as const;

/**
 * Source ids whose every item is, by construction, on the user's watchlist
 * (#514). Membership reads scope to THESE caches — NOT all of `mediaKeys.root`,
 * which also spans home rows (recommendations, trending, continue-watching, …)
 * whose items are NOT on the watchlist. Beyond the canonical all-items list this
 * also covers the watchlist page's sibling feeds (mood / tonight / recently) and
 * the home `yourWatchlist` row — all of which read through the same watchlist
 * source, so an item loaded via any of them is genuinely saved. Without them an
 * item paged in only by, say, a mood cluster read as "not on the watchlist" in
 * the peek modal even though it was. Add new watchlist-origin sources here.
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
 * Composite-id snapshot for cross-feature consumers, scoped to the watchlist-
 * origin sources (#514). Walks every loaded watchlist-origin sub-cache and
 * unions the ids the user has seen. Best-effort: surfaces that read this set
 * before any page loads get an empty set and rely on the server's idempotent
 * `addItem` to absorb add-when-already-saved.
 */
export function useWatchlistIdSet(): ReadonlySet<string> {
  const qc = useQueryClient();
  const version = useSyncExternalStore(
    (notify) => {
      const unsub = qc.getQueryCache().subscribe(notify);
      return () => unsub();
    },
    // Scope the snapshot to the watchlist-origin sub-caches (mirrors
    // `useIsInWatchlist` below). A whole-cache `getAll().length` advanced on
    // every unrelated query landing (home rows, detail fetches), forcing a
    // spurious `useMemo` recompute in every consumer; summing `dataUpdatedAt`
    // over just the watchlist-origin queries advances only when this set can
    // actually change.
    () => {
      let v = 0;
      for (const q of watchlistOriginQueries(qc)) v += q.state.dataUpdatedAt;
      return v;
    },
    () => 0,
  );
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
 * Reactive membership check across every loaded watchlist-origin sub-cache
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
      for (const q of watchlistOriginQueries(qc)) v += q.state.dataUpdatedAt;
      return v;
    },
    () => 0,
  );
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

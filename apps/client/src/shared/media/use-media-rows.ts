// fallow-ignore-file unused-file
// Reason: this layer lands before its consumers — the list hooks are wired into the home / watchlist shells in US-008 / US-009.
import {
  type InfiniteData,
  infiniteQueryOptions,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import type { CompactMediaItem, Page } from "@ent-mcp/shared/media";
import { mediaKeys } from "./query-keys";
import type { ClientMediaSource } from "./source";

/**
 * The flattened projection every media list renders: the concatenated items
 * across loaded pages plus the OR-reduced `partial` flag (once any page shipped
 * a partial-aggregate signal the list stays flagged so the UI can show a
 * non-blocking degraded marker).
 */
export interface MediaRows {
  items: CompactMediaItem[];
  partial: boolean;
}

/**
 * The flatten + partial OR-reduce, defined exactly once (invariant V.CL1). A
 * module-level reference keeps React Query's `select` memoization stable, so it
 * only re-runs when the page set changes — not on every render.
 */
const selectMediaRows = (data: InfiniteData<Page>): MediaRows => ({
  items: data.pages.flatMap((page) => page.items),
  partial: data.pages.some((page) => page.partial),
});

/**
 * The one infinite-query core for every media list (design §B1, invariant
 * V.CL1). Both wrappers below share this single definition of the cursor
 * threading (`getNextPageParam`), the flatten, and the `partial` OR-reduce, so
 * home rows and watchlist sections no longer maintain two near-identical hooks.
 */
export function mediaRowsQueryOptions<P extends object>(source: ClientMediaSource<P>) {
  return infiniteQueryOptions({
    queryKey: mediaKeys.source(source.sourceId, source.params as Record<string, unknown>),
    queryFn: ({ pageParam }) => source.fetchPage(source.params, pageParam ?? null),
    initialPageParam: (source.initialCursor ?? undefined) as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
    select: selectMediaRows,
  });
}

/**
 * Suspense reader for a media list (design §B1). Backs watchlist sections, which
 * mount under a route-loader-prefetched Suspense boundary — the page renders
 * with data on first paint. Mirrors today's `useAllItems` / `useMoodCluster`
 * surface.
 */
export function useMediaRows<P extends object>(source: ClientMediaSource<P>) {
  const query = useSuspenseInfiniteQuery(mediaRowsQueryOptions(source));
  return {
    items: query.data.items,
    partial: query.data.partial,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

/**
 * Lazy (non-suspense) reader for a media list (design §B1). Backs home rows,
 * which mount in parallel under the feed's single Suspense boundary so a slow
 * row shows a per-row skeleton without blocking the rest. Mirrors today's
 * `useHomeRow` surface (adds `isLoading` / `isRefetching` / `error` / `refetch`).
 */
export function useMediaRowsLazy<P extends object>(source: ClientMediaSource<P>) {
  const query = useInfiniteQuery(mediaRowsQueryOptions(source));
  // `data` is undefined until the first page lands; fall back to an empty list.
  const rows = query.data ?? { items: [], partial: false };
  return {
    items: rows.items,
    partial: rows.partial,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

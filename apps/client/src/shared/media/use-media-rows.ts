import {
  type InfiniteData,
  type QueryClient,
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
 * Caller-tunable query options. Kept narrow on purpose: a feature picks its own
 * `staleTime` (watchlist sections cache 60s like the old per-feature hooks did)
 * without being able to clobber the cursor / flatten / key wiring the core owns.
 */
export interface MediaRowsOptions {
  staleTime?: number;
}

/**
 * The one infinite-query core for every media list (design §B1, invariant
 * V.CL1). Both wrappers below share this single definition of the cursor
 * threading (`getNextPageParam`), the flatten, and the `partial` OR-reduce, so
 * home rows and watchlist sections no longer maintain two near-identical hooks.
 */
export function mediaRowsQueryOptions<P extends object>(
  source: ClientMediaSource<P>,
  options: MediaRowsOptions = {},
) {
  // Seeded sources (`similarTo`) take no params — the only thing that
  // distinguishes one title's related feed from another is `initialCursor`, so
  // fold it into the cache key. Without it every detail page shares
  // `['media','source','similarTo',null]` and title B renders title A's items
  // (the old `homeKeys.row(rowId, cursor)` keyed on the cursor for this reason).
  // Non-seeded sources keep their previous key (no `seed` entry).
  const params = source.params as Record<string, unknown>;
  const key = source.initialCursor != null ? { ...params, seed: source.initialCursor } : params;
  return infiniteQueryOptions({
    queryKey: mediaKeys.source(source.sourceId, key),
    queryFn: ({ pageParam }) => source.fetchPage(source.params, pageParam ?? null),
    initialPageParam: (source.initialCursor ?? undefined) as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
    select: selectMediaRows,
    ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
  });
}

/**
 * Loader-side counterpart of {@link useMediaRows} (design §B4, #513): warm the
 * first page of a media list into the cache before the route renders. A route
 * `loader` awaits this so the suspense section paints with data on first mount
 * instead of a fallback. It threads the SAME `mediaRowsQueryOptions` the hook
 * reads, so the cache key matches exactly and the component never refetches.
 */
export function prefetchMediaRows<P extends object>(
  queryClient: QueryClient,
  source: ClientMediaSource<P>,
): Promise<unknown> {
  return queryClient.ensureInfiniteQueryData(mediaRowsQueryOptions(source));
}

/**
 * Suspense reader for a media list (design §B1). Backs watchlist sections, which
 * mount under a route-loader-prefetched Suspense boundary — the page renders
 * with data on first paint. Mirrors today's `useAllItems` / `useMoodCluster`
 * surface.
 */
export function useMediaRows<P extends object>(
  source: ClientMediaSource<P>,
  options?: MediaRowsOptions,
) {
  const query = useSuspenseInfiniteQuery(mediaRowsQueryOptions(source, options));
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
export function useMediaRowsLazy<P extends object>(
  source: ClientMediaSource<P>,
  options?: MediaRowsOptions,
) {
  const query = useInfiniteQuery(mediaRowsQueryOptions(source, options));
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

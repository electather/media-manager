import {
  type InfiniteData,
  type QueryClient,
  infiniteQueryOptions,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import type { CompactMediaItem, Page } from "@nama/shared/media";
import { mediaKeys } from "./query-keys";
import type { ClientMediaSource } from "./source";

/**
 * Concatenated items across pages + OR-reduced `partial` flag
 * (stays true if any page signals partial to show degraded UI).
 */
export interface MediaRows {
  items: CompactMediaItem[];
  partial: boolean;
}

/**
 * Flatten + OR-reduce (invariant V.CL1). Module-level ref keeps
 * `select` memoization stable — only re-runs on page set changes.
 */
const selectMediaRows = (data: InfiniteData<Page>): MediaRows => ({
  items: data.pages.flatMap((page) => page.items),
  partial: data.pages.some((page) => page.partial),
});

/**
 * Caller-tunable options (e.g., `staleTime`). Kept narrow: features can tune
 * cache (home rows 5min) without clobbering core's cursor/flatten/key wiring.
 * Defaults to QueryClient's 60s (watchlist sections rely on this).
 */
export interface MediaRowsOptions {
  staleTime?: number;
}

/**
 * One infinite-query core for all media lists (design §B1, V.CL1).
 * Shared by home rows and watchlist sections to avoid duplicate hooks.
 */
export function mediaRowsQueryOptions<P extends object>(
  source: ClientMediaSource<P>,
  options: MediaRowsOptions = {},
) {
  // Seeded sources (`similarTo`) fold `initialCursor` into the key to distinguish
  // one title's feed from another (else title B renders title A's items).
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
 * Preload media list page into cache before route renders (design §B4, #513).
 * Uses same `mediaRowsQueryOptions` as hook to avoid refetch on mount.
 */
export function prefetchMediaRows<P extends object>(
  queryClient: QueryClient,
  source: ClientMediaSource<P>,
): Promise<unknown> {
  return queryClient.ensureInfiniteQueryData(mediaRowsQueryOptions(source));
}

/**
 * Suspense reader for media lists (design §B1). Backs watchlist sections
 * under prefetched Suspense boundaries with data on first paint.
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
 * Non-suspense reader for home rows (design §B1). Mounts in parallel under
 * feed Suspense boundary; slow rows show per-row skeleton without blocking.
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

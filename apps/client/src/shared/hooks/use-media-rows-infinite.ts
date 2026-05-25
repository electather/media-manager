import { useMemo } from "react";
import { useInfiniteQuery, useSuspenseInfiniteQuery, type QueryKey } from "@tanstack/react-query";

/**
 * Wire shape for a paginated media row response. The two cursor styles —
 * keyset (string) and offset (number) — coexist on the same union: the
 * server picks one and the hook treats `null`/`undefined` as "no more
 * pages" for both. `partial` rides forward as the row's degraded-aggregate
 * marker (some plugin shipped late, the rest of the page is still safe).
 */
export interface MediaRowsPage<T> {
  items: T[];
  cursor?: string | null;
  nextOffset?: number | null;
  partial?: boolean;
}

export type MediaRowsPageParam = string | number | null | undefined;

export interface UseMediaRowsInfiniteArgs<T, P extends MediaRowsPageParam> {
  queryKey: QueryKey;
  initialPageParam: P;
  fetchPage: (pageParam: P) => Promise<MediaRowsPage<T>>;
  getNextPageParam: (last: MediaRowsPage<T>) => P | undefined | null;
  staleTime?: number;
}

export interface UseMediaRowsInfiniteResult<T> {
  items: T[];
  partial: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  refetch: () => void;
}

function flattenPages<T>(pages: ReadonlyArray<MediaRowsPage<T>> | undefined): T[] {
  if (!pages) return [];
  return pages.flatMap((p) => p.items);
}

function anyPartial<T>(pages: ReadonlyArray<MediaRowsPage<T>> | undefined): boolean {
  return pages?.some((p) => p.partial === true) ?? false;
}

/**
 * Non-suspense paginated row hook. Rails on a home-style page mount in
 * parallel under one page-level Suspense boundary, so per-row inline
 * skeletons (driven by `isLoading`) keep the rest of the feed visible
 * while a slow row hydrates.
 */
export function useMediaRowsInfinite<T, P extends MediaRowsPageParam>(
  args: UseMediaRowsInfiniteArgs<T, P>,
): UseMediaRowsInfiniteResult<T> {
  const query = useInfiniteQuery({
    queryKey: args.queryKey,
    queryFn: ({ pageParam }) => args.fetchPage(pageParam as P),
    initialPageParam: args.initialPageParam,
    getNextPageParam: (last) => args.getNextPageParam(last) ?? undefined,
    ...(args.staleTime != null ? { staleTime: args.staleTime } : {}),
  });
  const items = useMemo(() => flattenPages<T>(query.data?.pages), [query.data?.pages]);
  const partial = useMemo(() => anyPartial<T>(query.data?.pages), [query.data?.pages]);
  return {
    items,
    partial,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Suspense-driven paginated row hook. The page (e.g. /watchlist) suspends
 * until the first page resolves, after which `items` is always defined.
 * Filter / sort / bucket variants ride on the query key so React Query
 * treats each shape as its own cache; a shared root invalidate
 * (`createMediaQueryKeys(namespace).all`) sweeps them together.
 */
export function useMediaRowsInfiniteSuspense<T, P extends MediaRowsPageParam>(
  args: UseMediaRowsInfiniteArgs<T, P>,
): Omit<UseMediaRowsInfiniteResult<T>, "isLoading" | "error" | "refetch" | "isRefetching"> {
  const query = useSuspenseInfiniteQuery({
    queryKey: args.queryKey,
    queryFn: ({ pageParam }) => args.fetchPage(pageParam as P),
    initialPageParam: args.initialPageParam,
    getNextPageParam: (last) => args.getNextPageParam(last) ?? undefined,
    ...(args.staleTime != null ? { staleTime: args.staleTime } : {}),
  });
  const items = useMemo(() => flattenPages<T>(query.data.pages), [query.data.pages]);
  const partial = useMemo(() => anyPartial<T>(query.data.pages), [query.data.pages]);
  return {
    items,
    partial,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

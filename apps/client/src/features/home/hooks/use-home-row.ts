import { useMemo } from "react";
import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import type { CompactMediaItem, RowContentResponse } from "@ent-mcp/shared/home";
import { fetchHomeRow } from "../lib/fetchers";
import { homeKeys } from "../lib/query-keys";

export interface UseHomeRowResult {
  items: CompactMediaItem[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isRefetching: boolean;
  partial: boolean;
  error: Error | null;
  refetch: () => void;
}

const ROW_STALE_MS = 5 * 60 * 1000;

/**
 * Live row content for `rowId`. Drives infinite pagination: each page's
 * `cursor` becomes the next `pageParam`, and the hook surfaces a flat
 * `items` array plus a `fetchNextPage` callback for the row scroller's
 * IntersectionObserver to call.
 *
 * `partial` is the union of every page's partial flag — once any page
 * shipped a partial-aggregate signal the row stays flagged so the UI can
 * render a non-blocking degraded marker.
 *
 * Stays on `useInfiniteQuery` (not the suspense variant) because rows
 * mount in parallel under the page's Suspense boundary; per-row inline
 * skeletons keep the rest of the feed visible while a slow row hydrates.
 */
export function useHomeRow(rowId: string, initialCursor: string | null): UseHomeRowResult {
  const query = useInfiniteQuery({
    queryKey: homeKeys.row(rowId, initialCursor),
    queryFn: ({ pageParam }) => fetchHomeRow(rowId, pageParam ?? initialCursor),
    initialPageParam: initialCursor,
    getNextPageParam: (last) => last.cursor,
    staleTime: ROW_STALE_MS,
  }) satisfies UseInfiniteQueryResult<{ pages: RowContentResponse[] }, Error>;
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages],
  );
  const partial = query.data?.pages.some((p) => p.partial === true) ?? false;
  return {
    items,
    // `fetchNextPage` and `refetch` are bound to the observer instance and
    // stable across renders. Internal guards no-op when `hasNextPage` is
    // false or a fetch is already in flight, so no wrapper is needed.
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    partial,
    error: query.error,
    refetch: query.refetch,
  };
}

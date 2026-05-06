import { useMemo } from "react";
import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import type { CompactMediaItem, RowContentResponse } from "@ent-mcp/shared/home";

export interface UseHomeRowResult {
  items: CompactMediaItem[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  partial: boolean;
  error: Error | null;
}

const ROW_STALE_MS = 5 * 60 * 1000;

async function fetchRow(
  rowId: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<RowContentResponse> {
  const params = new URLSearchParams({ rowId });
  if (cursor !== null) params.set("cursor", cursor);
  const res = await fetch(`/api/home/row?${params.toString()}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`home/row ${rowId} ${res.status}`);
  return (await res.json()) as RowContentResponse;
}

/**
 * Live row content for `rowId`. Drives infinite pagination: each page's
 * `cursor` becomes the next `pageParam`, and the hook surfaces a flat
 * `items` array plus a `fetchNextPage` callback for the row scroller's
 * IntersectionObserver to call.
 *
 * `partial` is the union of every page's partial flag — once any page
 * shipped a partial-aggregate signal the row stays flagged so the UI can
 * render a non-blocking degraded marker.
 */
export function useHomeRow(rowId: string, initialCursor: string | null): UseHomeRowResult {
  const query = useInfiniteQuery({
    queryKey: ["home", "row", rowId, initialCursor] as const,
    queryFn: ({ pageParam, signal }) => fetchRow(rowId, pageParam ?? initialCursor, signal),
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
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    partial,
    error: query.error,
  };
}

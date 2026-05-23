import { useMemo } from "react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import type { WatchlistBucket, WatchlistItem } from "@ent-mcp/shared/watchlist";
import { fetchWatchlist } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

export interface UseWatchlistItemsArgs {
  filter?: WatchlistBucket;
}

/**
 * Suspense-driven infinite query for `/api/watchlist`. The filter rides on
 * the query key so each bucket has its own cache; the page param is the
 * `cursor` returned by the previous response. `getNextPageParam` returns
 * `null` to stop pagination — React Query reads `undefined` as "no more
 * pages", so we coerce here.
 */
export function useWatchlistItems(args: UseWatchlistItemsArgs = {}) {
  const filter = args.filter;
  const query = useSuspenseInfiniteQuery({
    queryKey: watchlistKeys.list(filter ? { filter } : {}),
    queryFn: ({ pageParam }) =>
      fetchWatchlist({
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(filter ? { filter } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    staleTime: STALE_TIME_MS,
  });

  const items = useMemo<WatchlistItem[]>(
    () => query.data.pages.flatMap((p) => p.items),
    [query.data.pages],
  );
  const partial = useMemo(() => query.data.pages.some((p) => p.partial), [query.data.pages]);

  return {
    items,
    partial,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

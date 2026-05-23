import { useMemo } from "react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import type {
  MoodId,
  WatchlistBucket,
  WatchlistItem,
  WatchlistSort,
} from "@ent-mcp/shared/watchlist";
import { fetchItems } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

export interface UseAllItemsArgs {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * Paginated reader for `/api/watchlist/items`. Backs the flat
 * `/watchlist/all` view; sort/bucket/mood ride the query key so each
 * combination has its own cache.
 */
export function useAllItems(args: UseAllItemsArgs = {}) {
  const sort = args.sort ?? "recent";
  const bucket = args.bucket;
  const mood = args.mood;
  const opts: UseAllItemsArgs = { sort };
  if (bucket) opts.bucket = bucket;
  if (mood) opts.mood = mood;
  const query = useSuspenseInfiniteQuery({
    queryKey: watchlistKeys.items(opts),
    queryFn: ({ pageParam }) =>
      fetchItems({
        ...(pageParam ? { cursor: pageParam } : {}),
        sort,
        ...(bucket ? { bucket } : {}),
        ...(mood ? { mood } : {}),
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

import { useMemo } from "react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import type { MoodId, WatchlistItem } from "@ent-mcp/shared/watchlist";
import { fetchMoodItems } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

/**
 * Paginated reader for a single mood cluster: `/api/watchlist/moods/:id/items`.
 * Used by both the mood-mosaic preview (limit=3) and the dedicated mood
 * page (limit=60).
 */
export function useMoodCluster(moodId: MoodId, limit?: number) {
  const query = useSuspenseInfiniteQuery({
    queryKey: [...watchlistKeys.moodItems(moodId), limit ?? null] as const,
    queryFn: ({ pageParam }) =>
      fetchMoodItems(moodId, {
        ...(pageParam ? { cursor: pageParam } : {}),
        // fallow-ignore-next-line code-duplication
        ...(limit != null ? { limit } : {}),
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

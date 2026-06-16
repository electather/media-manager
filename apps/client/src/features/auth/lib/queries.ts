import { queryOptions } from "@tanstack/react-query";
import { fetchTrendingPosters } from "./fetchers";
import { authKeys } from "./query-keys";

const TRENDING_STALE_MS = 5 * 60 * 1000;

/**
 * Query options for the decorative public trending posters. Generic public
 * feed, so a 5-minute `staleTime` is plenty — the grid is background art and
 * never needs to be fresh.
 */
export const trendingPostersQueryOptions = (limit: number) =>
  queryOptions({
    queryKey: authKeys.trendingPosters(limit),
    queryFn: () => fetchTrendingPosters(limit),
    staleTime: TRENDING_STALE_MS,
    // Decorative background art with a placeholder fallback, so a slow or failing
    // feed never matters — one retry is plenty, rather than ~30s of default retries.
    retry: 1,
    // Suppress background refetches for purely decorative data to avoid unnecessary
    // load on the public endpoint when the user returns to or reconnects on the page.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

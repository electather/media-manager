import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchWatchlistCounts } from "@/shared/lib/watchlist/fetchers";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";

const STALE_TIME_MS = 60_000;

/**
 * Suspense-driven read of `/api/watchlist/counts`. Header pips read from
 * here instead of bucketizing the full list so the page stays responsive
 * even on 1000+ item watchlists where the list is paginated.
 */
export function useWatchlistCounts() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.counts(),
    queryFn: fetchWatchlistCounts,
    staleTime: STALE_TIME_MS,
  });
}

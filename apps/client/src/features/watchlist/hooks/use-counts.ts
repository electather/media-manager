import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchCounts } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

/**
 * Suspense-driven read of `/api/watchlist/counts`. Header pips read here
 * instead of bucketizing the full list so the page stays responsive even
 * on 1000+ item watchlists where the list is paginated.
 */
export function useCounts() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.counts(),
    queryFn: fetchCounts,
    staleTime: STALE_TIME_MS,
  });
}

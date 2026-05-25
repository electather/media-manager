import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchMoods } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

/**
 * Suspense-driven read of `/api/watchlist/moods`. Returns the mood-summary
 * cluster counts. Mood-cluster previews use `useMoodCluster(id, limit)` separately.
 */
export function useMoods() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.moods(),
    queryFn: fetchMoods,
    staleTime: STALE_TIME_MS,
  });
}

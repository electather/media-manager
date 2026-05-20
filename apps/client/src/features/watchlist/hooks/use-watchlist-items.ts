import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchWatchlist } from "@/shared/lib/watchlist/fetchers";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";

const STALE_TIME_MS = 60_000;

export function useWatchlistItems() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.list(),
    queryFn: fetchWatchlist,
    staleTime: STALE_TIME_MS,
  });
}

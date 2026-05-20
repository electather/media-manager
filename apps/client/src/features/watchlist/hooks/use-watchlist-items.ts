import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchWatchlist } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

export function useWatchlistItems() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.list(),
    queryFn: fetchWatchlist,
    staleTime: STALE_TIME_MS,
  });
}

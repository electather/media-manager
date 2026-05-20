import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWatchlist } from "@/shared/lib/watchlist/fetchers";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";

const EMPTY_SET: ReadonlySet<string> = new Set();
const STALE_TIME_MS = 60_000;

/**
 * Non-suspending watchlist read for cross-feature consumers (home feed,
 * search results, etc). Returns the set of composite ids currently on the
 * user's watchlist. Falls back to an empty set while the fetch is in flight
 * so the surface stays responsive instead of blocking the host route.
 */
export function useWatchlistIdSet(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: watchlistKeys.list(),
    queryFn: fetchWatchlist,
    staleTime: STALE_TIME_MS,
  });
  return useMemo(() => {
    if (!data) return EMPTY_SET;
    return new Set(data.items.map((i) => i.id));
  }, [data]);
}

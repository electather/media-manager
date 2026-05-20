import { useQuery } from "@tanstack/react-query";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { fetchWatchlist } from "@/shared/lib/watchlist/fetchers";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";

const STALE_TIME_MS = 60_000;

/**
 * Reactive membership check. Uses `useQuery` with a boolean `select` so the
 * component re-renders whenever the cache crosses the membership boundary.
 * `getQueryData` alone is a one-time snapshot — cross-feature consumers
 * (search rows, recommendation tiles) would render stale add/remove state
 * after a mutation settles because cache writes alone do not trigger renders.
 */
export function useIsInWatchlist(id: string): boolean {
  const { data } = useQuery({
    queryKey: watchlistKeys.list(),
    queryFn: fetchWatchlist,
    staleTime: STALE_TIME_MS,
    select: (response: WatchlistResponse) => response.items.some((i) => i.id === id),
  });
  return data ?? false;
}

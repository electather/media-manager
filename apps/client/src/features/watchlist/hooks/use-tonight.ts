import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchTonight } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;

/**
 * Suspense-driven read of `/api/watchlist/sections/tonight`. Returns the
 * server-picked hero + ≤4 alternates. Cached per-user 5 min on the server.
 */
export function useTonight() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.tonight(),
    queryFn: fetchTonight,
    staleTime: STALE_TIME_MS,
  });
}

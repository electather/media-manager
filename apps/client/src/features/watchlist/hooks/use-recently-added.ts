import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchRecently } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

const STALE_TIME_MS = 60_000;
const DEFAULT_LIMIT = 5;

/**
 * Suspense-driven read of `/api/watchlist/sections/recently`. Capped at
 * five rows by default so the strip stays a strip — no pagination needed.
 */
export function useRecentlyAdded(limit: number = DEFAULT_LIMIT) {
  return useSuspenseQuery({
    queryKey: [...watchlistKeys.recently(), limit] as const,
    queryFn: () => fetchRecently({ limit }),
    staleTime: STALE_TIME_MS,
  });
}

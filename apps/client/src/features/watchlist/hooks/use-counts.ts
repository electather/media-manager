import { useSuspenseQuery } from "@tanstack/react-query";
import { mediaKeys } from "@/shared/media/query-keys";
import { fetchCounts } from "@/shared/media/aggregates";

const STALE_TIME_MS = 60_000;

/**
 * Suspense-driven read of `/api/media/counts`. Header pips read here instead of
 * bucketizing the full list so the page stays responsive even on 1000+ item
 * watchlists where the list is paginated. Keyed under `mediaKeys.counts()` so
 * the one-shot mutation sweep flushes it (#505).
 */
export function useCounts() {
  return useSuspenseQuery({
    queryKey: mediaKeys.counts(),
    queryFn: fetchCounts,
    staleTime: STALE_TIME_MS,
  });
}

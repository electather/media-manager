import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPerfAggregate } from "../shared/fetchers";
import { diagnosticsKeys } from "../shared/query-keys";
import type { PerfFilters } from "../shared/types";

/** Primary perf-aggregate read. Suspends on first load and feeds the feature
 *  ErrorBoundary on failure. Polls every 30s — live monitoring view, kept
 *  under the 60s default so reopening the tab does not show a full poll of
 *  stale rows. The query key omits `sort`/`search` (applied client-side) so
 *  changing them re-derives from cache without a refetch. */
export function usePerfAggregate(filters: PerfFilters) {
  return useSuspenseQuery({
    queryKey: diagnosticsKeys.perf.aggregate(filters),
    queryFn: () => fetchPerfAggregate(filters),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    networkMode: "online",
  });
}

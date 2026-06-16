import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchErrorList } from "../shared/fetchers";
import { diagnosticsKeys } from "../shared/query-keys";
import type { ErrorsFilters } from "../shared/types";

/** Primary errors-table read. Suspends on first load and feeds the feature
 *  ErrorBoundary on failure. Polls every 30s — live monitoring view, kept
 *  under the 60s default so reopening the tab does not show a full poll of
 *  stale rows. */
export function useErrorsList(filters: ErrorsFilters) {
  return useSuspenseQuery({
    queryKey: diagnosticsKeys.errors.list(filters),
    queryFn: () => fetchErrorList(filters),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    networkMode: "online",
  });
}

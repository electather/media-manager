import { useSuspenseQuery } from "@tanstack/react-query";
import { requestsApi } from "./client";
import { requestFlowKeys } from "./query-keys";

const TARGETS_STALE_MS = 5 * 60_000;

/**
 * Suspense-style read of the request picker's target list. Cache is keyed on
 * `mediaType`; visiting any movie detail warms the cache for every other movie
 * detail in the session, so the picker pops with zero loading state on reopen.
 */
export function useRequestTargets(mediaType: "movie" | "tv") {
  const { data } = useSuspenseQuery({
    queryKey: requestFlowKeys.targets(mediaType),
    queryFn: () => requestsApi.targets({ mediaType }),
    staleTime: TARGETS_STALE_MS,
  });
  return data;
}

export const REQUEST_TARGETS_STALE_MS = TARGETS_STALE_MS;

import { useQuery } from "@tanstack/react-query";
import { requestsApi } from "./client";
import { requestFlowKeys } from "./query-keys";

// Shorter than the 60s default: this enriches list rows with the caller's live
// request status, so it should reflect a just-placed request promptly.
const HISTORY_STALE_MS = 30_000;

/**
 * Non-Suspense read of the caller's outstanding requests. Used as enrichment
 * over wire `item.status`; loading/fetch failure must not block render — the
 * caller falls back to wire status when `data` is undefined.
 */
export function useUserRequests() {
  return useQuery({
    queryKey: requestFlowKeys.history(),
    queryFn: () => requestsApi.history(),
    staleTime: HISTORY_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

export const REQUEST_HISTORY_STALE_MS = HISTORY_STALE_MS;

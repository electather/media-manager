import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@nama/shared/home";
import { homeLayoutQueryOptions } from "../lib/queries";

/**
 * Live `home.getLayout` query. Rows ship as stubs and each row's
 * `useMediaRowsLazy` source fills in the items on demand.
 *
 * Suspense read — the route loader prefetches via `homeLayoutQueryOptions`
 * (`ensureQueryData`), so the hook is cache-warm at component mount in the
 * happy path. The page still wraps the consumer in `<Suspense>` as a
 * defensive boundary for cache misses (revalidation, GC). Use
 * `useHomeFeedPool` for non-blocking reads in the app shell.
 */
export function useHomeFeed(): UseSuspenseQueryResult<HomeLayoutResponse, Error> {
  return useSuspenseQuery(homeLayoutQueryOptions());
}

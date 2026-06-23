import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@nama/shared/home";
import { homeLayoutQueryOptions } from "../lib/queries";

/** Suspense read; route loader prefetches so hook is cache-warm at mount. Use `useHomeFeedPool` for app shell non-blocking reads. */
export function useHomeFeed(): UseSuspenseQueryResult<HomeLayoutResponse, Error> {
  return useSuspenseQuery(homeLayoutQueryOptions());
}

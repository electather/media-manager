import { queryOptions } from "@tanstack/react-query";
import { fetchHomeLayout } from "./fetchers";
import { homeKeys } from "./query-keys";

const LAYOUT_STALE_MS = 5 * 60 * 1000;

/**
 * Shared `home.getLayout` query options. Single source for the route loader's
 * `ensureQueryData` call, the suspense `useHomeFeed` hook on the page, and
 * the non-blocking `useHomeFeedPool` hook in the app shell — all three hit
 * the same cache key with the same `staleTime`.
 *
 * `staleTime` matches the warm-job cadence (60min ÷ 12) so a casual tab
 * switch reuses the cache without re-hitting the layout endpoint.
 */
export const homeLayoutQueryOptions = () =>
  queryOptions({
    queryKey: homeKeys.layout(),
    queryFn: fetchHomeLayout,
    staleTime: LAYOUT_STALE_MS,
  });

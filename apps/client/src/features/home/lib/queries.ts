import { queryOptions } from "@tanstack/react-query";
import { fetchHomeLayout } from "./fetchers";
import { homeKeys } from "./query-keys";

const LAYOUT_STALE_MS = 5 * 60 * 1000;
const WARMING_POLL_MS = 5 * 1000;

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
    // A fresh install composes an empty layout until the discover-snapshot
    // job warms the catalog (kicked at onboarding completion). Poll every 5s
    // only while the layout is still empty so the feed fills in on its own,
    // and stop the moment any hero or row arrives. (frontend rule 12: polling.)
    refetchInterval: (query) => {
      const data = query.state.data;
      const isEmpty = !!data && data.hero === null && data.rows.length === 0;
      return isEmpty ? WARMING_POLL_MS : false;
    },
    refetchIntervalInBackground: false,
    networkMode: "online",
  });

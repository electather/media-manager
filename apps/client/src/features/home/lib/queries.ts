import { queryOptions } from "@tanstack/react-query";
import { fetchHomeLayout } from "./fetchers";
import { homeKeys } from "./query-keys";

const LAYOUT_STALE_MS = 5 * 60 * 1000;
const WARMING_POLL_MS = 5 * 1000;
const WARMING_POLL_CAP_MS = 30 * 1000;

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
    // job warms the catalog (kicked at onboarding completion). Poll only while
    // the layout is still empty so the feed fills in on its own, and stop the
    // moment any hero or row arrives. (frontend rule 12: polling.) The interval
    // backs off 5s → 10s → 20s → cap 30s as the warm job runs, since on a cold
    // TMDB cache it can take many round-trips — easing server load without
    // delaying the fill once content lands.
    refetchInterval: (query) => {
      const data = query.state.data;
      const isEmpty = !!data && data.hero === null && data.rows.length === 0;
      if (!isEmpty) return false;
      const polls = Math.max(0, query.state.dataUpdateCount - 1);
      return Math.min(WARMING_POLL_MS * 2 ** polls, WARMING_POLL_CAP_MS);
    },
    refetchIntervalInBackground: false,
    networkMode: "online",
  });

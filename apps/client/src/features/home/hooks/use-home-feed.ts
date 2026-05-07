import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { fetchHomeLayout } from "../lib/fetchers";
import { homeKeys } from "../lib/query-keys";

const LAYOUT_STALE_MS = 5 * 60 * 1000;

/**
 * Live `home.getLayout` query. Rows ship as stubs and per-row `useHomeRow`
 * fills in the items on demand.
 *
 * `staleTime` matches the warm-job cadence (60min ÷ 12) so a casual tab
 * switch reuses the cache without re-hitting the layout endpoint.
 *
 * Suspense read — the page wraps the consumer in `<Suspense>` plus
 * `<HomeErrorBoundary>` (rule 5). Use `useHomeFeedPool` for non-blocking
 * reads (e.g. the app-shell command-menu seed).
 */
export function useHomeFeed(): UseSuspenseQueryResult<HomeLayoutResponse, Error> {
  return useSuspenseQuery({
    queryKey: homeKeys.layout(),
    queryFn: fetchHomeLayout,
    staleTime: LAYOUT_STALE_MS,
  });
}

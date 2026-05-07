import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { fetchHomeLayout } from "../lib/fetchers";
import { homeKeys } from "../lib/query-keys";

const LAYOUT_STALE_MS = 5 * 60 * 1000;

/**
 * Non-blocking variant of `useHomeFeed` for the authenticated app shell.
 * Shares the layout cache key so the home page's suspense fetch and this
 * read coalesce into a single network request. Kept separate from
 * `useHomeFeed` because the app-shell consumer must NOT suspend the entire
 * authenticated layout while the feed loads — that would gate every route
 * (settings, admin, etc.) on the home payload.
 */
export function useHomeFeedPool(): UseQueryResult<HomeLayoutResponse, Error> {
  return useQuery({
    queryKey: homeKeys.layout(),
    queryFn: fetchHomeLayout,
    staleTime: LAYOUT_STALE_MS,
  });
}

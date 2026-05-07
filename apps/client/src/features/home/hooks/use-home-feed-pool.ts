import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { homeLayoutQueryOptions } from "../lib/queries";

/**
 * Non-blocking variant of `useHomeFeed` for the authenticated app shell.
 * Shares the layout cache key (via `homeLayoutQueryOptions`) so the route
 * loader's prefetch and the page's suspense read coalesce with this read
 * into a single network request. Kept separate from `useHomeFeed` because
 * the app-shell consumer must NOT suspend the entire authenticated layout
 * while the feed loads — that would gate every route (settings, admin,
 * etc.) on the home payload.
 */
export function useHomeFeedPool(): UseQueryResult<HomeLayoutResponse, Error> {
  return useQuery(homeLayoutQueryOptions());
}

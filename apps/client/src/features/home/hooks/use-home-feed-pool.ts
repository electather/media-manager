import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@nama/shared/home";
import { homeLayoutQueryOptions } from "../lib/queries";

/**
 * Non-blocking variant for app shell to avoid suspending entire authenticated layout.
 * Shares cache key so loader prefetch, page suspense, and this read coalesce into one network request.
 */
export function useHomeFeedPool(): UseQueryResult<HomeLayoutResponse, Error> {
  return useQuery(homeLayoutQueryOptions());
}

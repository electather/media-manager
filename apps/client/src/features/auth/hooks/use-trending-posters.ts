import { useQuery } from "@tanstack/react-query";
import { trendingPostersQueryOptions } from "../lib/queries";

/**
 * Non-suspense read of the public trending posters for the decorative auth-page
 * grid. Deliberately uses `useQuery` (not `useSuspenseQuery`) so the login form
 * renders immediately and is never gated on this request — while pending, on
 * error, or on an empty response the grid falls back to bundled branded art.
 */
export function useTrendingPosters(limit: number) {
  return useQuery(trendingPostersQueryOptions(limit));
}

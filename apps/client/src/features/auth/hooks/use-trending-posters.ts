import { useQuery } from "@tanstack/react-query";
import { trendingPostersQueryOptions } from "../lib/queries";

/** useQuery (not useSuspenseQuery) so login form never gates on this request. */
export function useTrendingPosters(limit: number) {
  return useQuery(trendingPostersQueryOptions(limit));
}

import { useQuery } from "@tanstack/react-query";

import { fetchTrending, type SearchResult, type TrendingScope } from "../lib/fetchers";
import { commandMenuKeys } from "../lib/query-keys";

const STALE_MS = 5 * 60_000;
const TRENDING_LIMIT = 12;

export interface UseTrendingResult {
  data: SearchResult | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Live `/api/discover/trending` results scoped to the active TV or movie
 * search frame. Stale-window is generous (5 min) — trending shifts slowly
 * and the menu often opens repeatedly within a session.
 */
export function useTrending(scope: TrendingScope | null): UseTrendingResult {
  const enabled = scope !== null;
  const query = useQuery({
    queryKey: scope ? commandMenuKeys.trending(scope) : commandMenuKeys.all,
    queryFn: () => fetchTrending({ mediaType: scope as TrendingScope, limit: TRENDING_LIMIT }),
    enabled,
    staleTime: STALE_MS,
  });
  return {
    data: enabled ? query.data : undefined,
    isPending: enabled && query.isPending,
    isError: enabled && query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

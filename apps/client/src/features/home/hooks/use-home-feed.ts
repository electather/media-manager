import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";

const LAYOUT_KEY = ["home", "layout"] as const;
const LAYOUT_STALE_MS = 5 * 60 * 1000;

async function fetchLayout(signal: AbortSignal): Promise<HomeLayoutResponse> {
  const res = await fetch("/api/home/layout", { credentials: "include", signal });
  if (!res.ok) throw new Error(`home/layout ${res.status}`);
  return (await res.json()) as HomeLayoutResponse;
}

/**
 * Live `home.getLayout` query. Replaces the mock-data feed; rows ship as
 * stubs and the per-row `useHomeRow` hook fills in the items on demand.
 *
 * `staleTime` matches the warm-job cadence (60min ÷ 12) so a casual tab
 * switch reuses the cache without re-hitting the layout endpoint.
 */
export function useHomeFeed(): UseQueryResult<HomeLayoutResponse, Error> {
  return useQuery({
    queryKey: LAYOUT_KEY,
    queryFn: ({ signal }) => fetchLayout(signal),
    staleTime: LAYOUT_STALE_MS,
  });
}

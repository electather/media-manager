import { useQuery } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { api } from "@/lib/api";

export const HOME_LAYOUT_QUERY_KEY = ["home", "layout"] as const;

async function fetchLayout(): Promise<HomeLayoutResponse> {
  const res = await api.home.getLayout.$post({ json: {} });
  if (!res.ok) {
    throw new Error(`home.getLayout failed: ${res.status}`);
  }
  return (await res.json()) as HomeLayoutResponse;
}

export function useHomeLayout() {
  return useQuery({
    queryKey: HOME_LAYOUT_QUERY_KEY,
    queryFn: fetchLayout,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

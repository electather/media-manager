import { useQuery } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";

import { api } from "@/shared/lib/api";

import { homeKeys } from "../lib/keys";

const LAYOUT_STALE_MS = 60_000;

export function useHomeLayout() {
  return useQuery({
    queryKey: homeKeys.layout(),
    queryFn: async (): Promise<HomeLayoutResponse> => {
      const res = await api.home.getLayout.$post({ json: {} });
      if (!res.ok) throw new Error("home.internal");
      return (await res.json()) as HomeLayoutResponse;
    },
    staleTime: LAYOUT_STALE_MS,
  });
}

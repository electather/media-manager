import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { api } from "@/shared/lib/api";
import { queryClient } from "@/shared/lib/db";

/**
 * Single-row wrapper around the `home.getLayout` response. The row carries
 * the hero pointer plus per-row stubs (with their first cursor) — sync
 * helpers advance cursors via `queryClient.setQueryData(["home","layout"], …)`
 * (V89), never via `writeUpsert`.
 */
export interface HomeLayoutRow extends HomeLayoutResponse {
  id: "current";
}

export const HOME_LAYOUT_QUERY_KEY = ["home", "layout"] as const;

export const homeLayoutCollection = createCollection(
  queryCollectionOptions<HomeLayoutRow>({
    id: "home.layout",
    queryKey: [...HOME_LAYOUT_QUERY_KEY],
    queryClient,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await api.home.getLayout.$post({ json: {} });
      if (!res.ok) throw new Error("home.getLayout failed");
      const layout = (await res.json()) as HomeLayoutResponse;
      return [{ ...layout, id: "current" as const }];
    },
    getKey: (row) => row.id,
  }),
);

import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { fetchAdminDeliveriesPage } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { AdminDeliveryFilters } from "../shared/types";

export function useAdminDeliveries(filters: AdminDeliveryFilters) {
  return useSuspenseInfiniteQuery({
    queryKey: notificationsKeys.admin.deliveries(filters),
    queryFn: ({ pageParam }) => fetchAdminDeliveriesPage(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last: { nextCursor?: string }) =>
      typeof last.nextCursor === "string" ? last.nextCursor : null,
  });
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchAdminDelivery } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useAdminDelivery(id: string) {
  return useSuspenseQuery({
    queryKey: notificationsKeys.admin.delivery(id),
    queryFn: () => fetchAdminDelivery(id),
  });
}

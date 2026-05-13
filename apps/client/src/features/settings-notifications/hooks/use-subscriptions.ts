import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchSubscriptions } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";

export function useSubscriptions() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.subscriptions(),
    queryFn: fetchSubscriptions,
  });
}

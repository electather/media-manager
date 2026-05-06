import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchSubscriptions } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useSubscriptions() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.subscriptions(),
    queryFn: fetchSubscriptions,
  });
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPlugins } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";

export function useNotificationPlugins() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.plugins(),
    queryFn: async () => {
      const body = await fetchPlugins();
      return body.plugins;
    },
  });
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPlugins } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { NotificationPluginEntry } from "./types";

export function useNotificationPlugins() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.plugins(),
    queryFn: async () => {
      const body = await fetchPlugins();
      return body.plugins as NotificationPluginEntry[];
    },
  });
}

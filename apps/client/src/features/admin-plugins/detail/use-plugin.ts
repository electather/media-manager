import { useSuspenseQuery } from "@tanstack/react-query";

import { fetchPluginsList } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";

export function usePlugin(pluginId: string) {
  return useSuspenseQuery({
    queryKey: adminPluginsKeys.list(),
    queryFn: async () => {
      const body = await fetchPluginsList();
      return body.plugins;
    },
    select: (rows) => rows.find((p) => p.id === pluginId) ?? null,
  });
}

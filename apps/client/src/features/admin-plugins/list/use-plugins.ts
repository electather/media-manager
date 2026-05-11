import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPluginsList } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";

export function usePlugins() {
  return useSuspenseQuery({
    queryKey: adminPluginsKeys.list(),
    queryFn: async () => {
      const body = await fetchPluginsList();
      return body.plugins;
    },
  });
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchAvailablePlugins } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useAvailablePlugins() {
  return useSuspenseQuery({
    queryKey: settingsConnectionsKeys.availablePlugins(),
    queryFn: fetchAvailablePlugins,
  });
}

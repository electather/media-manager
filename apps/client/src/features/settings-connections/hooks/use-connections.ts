import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchConnections } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useConnections() {
  return useSuspenseQuery({
    queryKey: settingsConnectionsKeys.connections(),
    queryFn: fetchConnections,
  });
}

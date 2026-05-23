import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPrimaryConnections } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function usePrimaryConnections() {
  return useSuspenseQuery({
    queryKey: settingsConnectionsKeys.primary(),
    queryFn: fetchPrimaryConnections,
  });
}

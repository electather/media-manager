import type { ConnectionListItem } from "@nama/shared/connections";
import { useOptimisticArrayMutation } from "@/shared/hooks/use-optimistic-array-mutation";
import { fetchDeleteConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useDeleteConnection() {
  return useOptimisticArrayMutation<ConnectionListItem, string>({
    queryKey: settingsConnectionsKeys.connections(),
    mutationFn: fetchDeleteConnection,
    update: (prev, id) => prev.filter((connection) => connection.id !== id),
  });
}

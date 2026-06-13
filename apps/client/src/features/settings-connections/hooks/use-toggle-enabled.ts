import type { ConnectionListItem } from "@nama/shared/connections";
import { useOptimisticArrayMutation } from "@/shared/hooks/use-optimistic-array-mutation";
import { fetchToggleConnectionEnabled } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useToggleEnabled() {
  return useOptimisticArrayMutation<ConnectionListItem, { id: string; enabled: boolean }>({
    queryKey: settingsConnectionsKeys.connections(),
    mutationFn: fetchToggleConnectionEnabled,
    update: (prev, input) =>
      prev.map((connection) =>
        connection.id === input.id ? { ...connection, enabled: input.enabled } : connection,
      ),
  });
}

import type { ConnectionListItem } from "@ent-mcp/shared/connections";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchToggleConnectionEnabled } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useToggleEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchToggleConnectionEnabled,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: settingsConnectionsKeys.connections() });
      const prev = qc.getQueryData<ConnectionListItem[]>(settingsConnectionsKeys.connections());
      if (prev) {
        qc.setQueryData<ConnectionListItem[]>(
          settingsConnectionsKeys.connections(),
          prev.map((connection) =>
            connection.id === input.id ? { ...connection, enabled: input.enabled } : connection,
          ),
        );
      }
      return { prev };
    },
    onError: (_error, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(settingsConnectionsKeys.connections(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
    },
  });
}

import type { ConnectionListItem } from "@ent-mcp/shared/connections";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchDeleteConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchDeleteConnection,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: settingsConnectionsKeys.connections() });
      const prev = qc.getQueryData<ConnectionListItem[]>(settingsConnectionsKeys.connections());
      if (prev) {
        qc.setQueryData<ConnectionListItem[]>(
          settingsConnectionsKeys.connections(),
          prev.filter((connection) => connection.id !== id),
        );
      }
      return { prev };
    },
    onError: (_error, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(settingsConnectionsKeys.connections(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
    },
  });
}

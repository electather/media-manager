import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchSetDefaultConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useSetDefaultConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchSetDefaultConnection,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
    },
  });
}

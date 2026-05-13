import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchTestConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchTestConnection,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
    },
  });
}

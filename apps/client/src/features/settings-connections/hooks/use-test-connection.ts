import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchTestConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchTestConnection,
    // Invalidate on settled rather than success so the row reflects the
    // server-side status update even when the test reports ok: false.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
    },
  });
}

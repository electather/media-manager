import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchSetEnabled } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";
import { makeOptimisticListHandlers } from "../shared/use-plugin-mutation";

export function useTogglePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchSetEnabled,
    ...makeOptimisticListHandlers<{ pluginId: string; enabled: boolean }>(
      qc,
      (p, input) => ({ ...p, enabled: input.enabled }),
      "Couldn't update plugin",
    ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
  });
}

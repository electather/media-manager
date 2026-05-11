import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchSaveGlobalConfig } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";

export function useUpdateConfig(pluginId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) => fetchSaveGlobalConfig({ pluginId, config }),
    onSuccess: async () => {
      toast.success("Configuration saved");
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.globalConfig(pluginId) });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save configuration");
    },
  });
}

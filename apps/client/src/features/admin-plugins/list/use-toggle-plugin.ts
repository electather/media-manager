import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchSetEnabled } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";
import type { PluginRow } from "../shared/types";

export function useTogglePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchSetEnabled,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: adminPluginsKeys.list() });
      const snapshot = qc.getQueryData<PluginRow[]>(adminPluginsKeys.list());
      qc.setQueryData<PluginRow[] | undefined>(adminPluginsKeys.list(), (rows) =>
        rows?.map((p) => (p.id === input.pluginId ? { ...p, enabled: input.enabled } : p)),
      );
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(adminPluginsKeys.list(), ctx.snapshot);
      toast.error("Couldn't update plugin");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
  });
}

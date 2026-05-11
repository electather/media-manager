import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { fetchSetFallback } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";
import type { PluginRow } from "../shared/types";

export function useUpdateFallback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchSetFallback,
    onMutate: async (input: { pluginId: string; policy: PersonalKeyFallbackPolicy }) => {
      await qc.cancelQueries({ queryKey: adminPluginsKeys.list() });
      const snapshot = qc.getQueryData<PluginRow[]>(adminPluginsKeys.list());
      qc.setQueryData<PluginRow[] | undefined>(adminPluginsKeys.list(), (rows) =>
        rows?.map((p) =>
          p.id === input.pluginId ? { ...p, personalKeyFallback: input.policy } : p,
        ),
      );
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(adminPluginsKeys.list(), ctx.snapshot);
      toast.error("Couldn't update fallback policy");
    },
    onSuccess: () => {
      toast.success("Fallback policy updated");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
  });
}

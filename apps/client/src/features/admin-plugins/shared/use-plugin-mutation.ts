import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { adminPluginsKeys } from "./query-keys";
import type { PluginRow } from "./types";

export function usePluginMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  successMsg: string,
  errorFallbackMsg: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      toast.success(successMsg);
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : errorFallbackMsg);
    },
  });
}

export function makeOptimisticListHandlers<TInput extends { pluginId: string }>(
  qc: QueryClient,
  patch: (plugin: PluginRow, input: TInput) => PluginRow,
  errorMsg: string,
) {
  return {
    onMutate: async (input: TInput) => {
      await qc.cancelQueries({ queryKey: adminPluginsKeys.list() });
      const snapshot = qc.getQueryData<PluginRow[]>(adminPluginsKeys.list());
      qc.setQueryData<PluginRow[] | undefined>(adminPluginsKeys.list(), (rows) =>
        rows?.map((p) => (p.id === input.pluginId ? patch(p, input) : p)),
      );
      return { snapshot };
    },
    onError: (_err: unknown, _input: TInput, ctx?: { snapshot: PluginRow[] | undefined }) => {
      if (ctx?.snapshot) qc.setQueryData(adminPluginsKeys.list(), ctx.snapshot);
      toast.error(errorMsg);
    },
  };
}

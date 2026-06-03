import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { rollbackQuery, snapshotQuery } from "@/shared/lib/query/optimistic";
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

export function useOptimisticPluginMutation<TInput extends { pluginId: string }, TOutput = unknown>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  patch: (plugin: PluginRow, input: TInput) => PluginRow,
  errorMsg: string,
  successMsg?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (input) => {
      const { prev: snapshot } = await snapshotQuery<PluginRow[]>(
        qc,
        adminPluginsKeys.list(),
        (rows) => rows?.map((p) => (p.id === input.pluginId ? patch(p, input) : p)),
      );
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.snapshot) rollbackQuery(qc, adminPluginsKeys.list(), ctx.snapshot);
      toast.error(errorMsg);
    },
    onSuccess: successMsg
      ? () => {
          toast.success(successMsg);
        }
      : undefined,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
  });
}

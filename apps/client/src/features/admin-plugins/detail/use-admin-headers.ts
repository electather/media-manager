import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchDeleteAdminHeader, fetchUpsertAdminHeader } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";

export function useUpsertAdminHeader(pluginId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; value: string }) =>
      fetchUpsertAdminHeader({ pluginId, name: input.name, value: input.value }),
    onSuccess: async () => {
      toast.success("Header saved");
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save header");
    },
  });
}

export function useDeleteAdminHeader(pluginId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => fetchDeleteAdminHeader({ pluginId, name }),
    onSuccess: async () => {
      toast.success("Header deleted");
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't delete header");
    },
  });
}

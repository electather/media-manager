import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchSetAdminAllowlist } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";

export function useUpdateAllowlist(pluginId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (allowlist: string[] | null) => fetchSetAdminAllowlist({ pluginId, allowlist }),
    onSuccess: async () => {
      toast.success("Allowlist saved");
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save allowlist");
    },
  });
}

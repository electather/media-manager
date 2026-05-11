import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { fetchUninstallPlugin } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";

export function useUninstallPlugin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (pluginId: string) => fetchUninstallPlugin(pluginId),
    onSuccess: async () => {
      toast.success("Plugin uninstalled");
      await qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
      void navigate({ to: "/admin/plugins" });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't uninstall plugin");
    },
  });
}

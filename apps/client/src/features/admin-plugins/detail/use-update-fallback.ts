import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { fetchSetFallback } from "../shared/fetchers";
import { adminPluginsKeys } from "../shared/query-keys";
import { makeOptimisticListHandlers } from "../shared/use-plugin-mutation";

export function useUpdateFallback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchSetFallback,
    ...makeOptimisticListHandlers<{ pluginId: string; policy: PersonalKeyFallbackPolicy }>(
      qc,
      (p, input) => ({ ...p, personalKeyFallback: input.policy }),
      "Couldn't update fallback policy",
    ),
    onSuccess: () => {
      toast.success("Fallback policy updated");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
    },
  });
}

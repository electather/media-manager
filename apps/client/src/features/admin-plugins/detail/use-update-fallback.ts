import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { fetchSetFallback } from "../shared/fetchers";
import { useOptimisticPluginMutation } from "../shared/use-plugin-mutation";

export function useUpdateFallback() {
  return useOptimisticPluginMutation(
    fetchSetFallback,
    (p, input: { pluginId: string; policy: PersonalKeyFallbackPolicy }) => ({
      ...p,
      personalKeyFallback: input.policy,
    }),
    "Couldn't update fallback policy",
    "Fallback policy updated",
  );
}

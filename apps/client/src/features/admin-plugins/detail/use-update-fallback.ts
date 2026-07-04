import type { PersonalKeyFallbackPolicy } from "@nama/shared/plugins";

import { m } from "@/paraglide/messages";

import { fetchSetFallback } from "../shared/fetchers";
import { useOptimisticPluginMutation } from "../shared/use-plugin-mutation";

export function useUpdateFallback() {
  return useOptimisticPluginMutation(
    fetchSetFallback,
    (p, input: { pluginId: string; policy: PersonalKeyFallbackPolicy }) => ({
      ...p,
      personalKeyFallback: input.policy,
    }),
    m.admin_plugins_toast_fallback_error(),
  );
}

import { m } from "@/paraglide/messages";

import { fetchSetEnabled } from "../shared/fetchers";
import { useOptimisticPluginMutation } from "../shared/use-plugin-mutation";

export function useTogglePlugin() {
  return useOptimisticPluginMutation(
    fetchSetEnabled,
    (p, input) => ({ ...p, enabled: input.enabled }),
    m.admin_plugins_toast_toggle_error(),
  );
}

import { m } from "@/paraglide/messages";

import { fetchSetAdminAllowlist } from "../shared/fetchers";
import { usePluginMutation } from "../shared/use-plugin-mutation";

export function useUpdateAllowlist(pluginId: string) {
  return usePluginMutation(
    (allowlist: string[] | null) => fetchSetAdminAllowlist({ pluginId, allowlist }),
    m.admin_plugins_toast_allowlist_saved(),
    m.admin_plugins_toast_allowlist_error(),
  );
}

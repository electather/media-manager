import { m } from "@/paraglide/messages";

import { fetchSetAdminHeader } from "../shared/fetchers";
import { usePluginMutation } from "../shared/use-plugin-mutation";

export function useUpsertAdminHeader(pluginId: string) {
  return usePluginMutation(
    (input: { name: string; value: string }) =>
      fetchSetAdminHeader({ pluginId, name: input.name, value: input.value }),
    m.admin_plugins_toast_header_saved(),
    m.admin_plugins_toast_header_save_error(),
  );
}

export function useDeleteAdminHeader(pluginId: string) {
  return usePluginMutation(
    (name: string) => fetchSetAdminHeader({ pluginId, name, value: null }),
    m.admin_plugins_toast_header_deleted(),
    m.admin_plugins_toast_header_delete_error(),
  );
}

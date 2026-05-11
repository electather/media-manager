import { fetchSetAdminHeader } from "../shared/fetchers";
import { usePluginMutation } from "../shared/use-plugin-mutation";

export function useUpsertAdminHeader(pluginId: string) {
  return usePluginMutation(
    (input: { name: string; value: string }) =>
      fetchSetAdminHeader({ pluginId, name: input.name, value: input.value }),
    "Header saved",
    "Couldn't save header",
  );
}

export function useDeleteAdminHeader(pluginId: string) {
  return usePluginMutation(
    (name: string) => fetchSetAdminHeader({ pluginId, name, value: null }),
    "Header deleted",
    "Couldn't delete header",
  );
}

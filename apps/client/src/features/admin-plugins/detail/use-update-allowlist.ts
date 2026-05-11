import { fetchSetAdminAllowlist } from "../shared/fetchers";
import { usePluginMutation } from "../shared/use-plugin-mutation";

export function useUpdateAllowlist(pluginId: string) {
  return usePluginMutation(
    (allowlist: string[] | null) => fetchSetAdminAllowlist({ pluginId, allowlist }),
    "Allowlist saved",
    "Couldn't save allowlist",
  );
}

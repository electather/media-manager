import { fetchSetEnabled } from "../shared/fetchers";
import { useOptimisticPluginMutation } from "../shared/use-plugin-mutation";

export function useTogglePlugin() {
  return useOptimisticPluginMutation(
    fetchSetEnabled,
    (p, input) => ({ ...p, enabled: input.enabled }),
    "Couldn't update plugin",
  );
}

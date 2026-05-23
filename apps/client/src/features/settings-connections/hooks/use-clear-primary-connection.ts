import type { PrimaryConnectionRow } from "@ent-mcp/shared/connections";
import type { MediaType } from "@ent-mcp/shared/media";
import { useOptimisticArrayMutation } from "@/shared/hooks/use-optimistic-array-mutation";
import { fetchClearPrimaryConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

interface ClearPrimaryInput {
  capabilityKey: string;
  mediaType: MediaType | null;
}

export function useClearPrimaryConnection() {
  return useOptimisticArrayMutation<PrimaryConnectionRow, ClearPrimaryInput>({
    queryKey: settingsConnectionsKeys.primary(),
    mutationFn: fetchClearPrimaryConnection,
    update: (prev, input) =>
      prev.filter(
        (row) => !(row.capabilityKey === input.capabilityKey && row.mediaType === input.mediaType),
      ),
  });
}

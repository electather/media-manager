import type { PrimaryConnectionRow } from "@ent-mcp/shared/connections";
import type { MediaType } from "@ent-mcp/shared/media";
import { useOptimisticArrayMutation } from "@/shared/hooks/use-optimistic-array-mutation";
import { fetchSetPrimaryConnection } from "../lib/fetchers";
import { settingsConnectionsKeys } from "../lib/query-keys";

interface SetPrimaryInput {
  capabilityKey: string;
  mediaType: MediaType | null;
  connectionId: string;
}

export function useSetPrimaryConnection() {
  return useOptimisticArrayMutation<PrimaryConnectionRow, SetPrimaryInput>({
    queryKey: settingsConnectionsKeys.primary(),
    mutationFn: fetchSetPrimaryConnection,
    update: (prev, input) => {
      const filtered = prev.filter(
        (row) => !(row.capabilityKey === input.capabilityKey && row.mediaType === input.mediaType),
      );
      return [
        ...filtered,
        {
          capabilityKey: input.capabilityKey,
          mediaType: input.mediaType,
          connectionId: input.connectionId,
        },
      ];
    },
  });
}

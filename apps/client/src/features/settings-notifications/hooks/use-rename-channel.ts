import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchRenameChannel } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import { rollbackChannels, snapshotAndUpdateChannels } from "../lib/optimistic-channels";

export function useRenameChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; displayName: string }) => fetchRenameChannel(input),
    onMutate: (input) =>
      snapshotAndUpdateChannels(qc, (channels) =>
        channels.map((channel) =>
          channel.id === input.id
            ? { ...channel, displayName: input.displayName || null }
            : channel,
        ),
      ),
    onError: (_err, _input, ctx) => rollbackChannels(qc, ctx?.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchDeleteChannel } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import { rollbackChannels, snapshotAndUpdateChannels } from "../lib/optimistic-channels";

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchDeleteChannel(id),
    onMutate: (id) =>
      snapshotAndUpdateChannels(qc, (channels) => channels.filter((channel) => channel.id !== id)),
    onError: (_err, _id, ctx) => rollbackChannels(qc, ctx?.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
      void qc.invalidateQueries({ queryKey: notificationsKeys.subscriptions() });
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchDeleteChannel } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { ChannelRowData } from "./types";

interface ChannelsData {
  channels: ChannelRowData[];
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchDeleteChannel(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.channels() });
      const prev = qc.getQueryData<ChannelsData>(notificationsKeys.channels());
      qc.setQueryData<ChannelsData>(notificationsKeys.channels(), (data) =>
        data ? { ...data, channels: data.channels.filter((channel) => channel.id !== id) } : data,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationsKeys.channels(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
      void qc.invalidateQueries({ queryKey: notificationsKeys.subscriptions() });
    },
  });
}

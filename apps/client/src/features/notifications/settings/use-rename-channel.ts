import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchRenameChannel } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { ChannelRowData } from "./types";

interface ChannelsData {
  channels: ChannelRowData[];
}

export function useRenameChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; displayName: string }) => fetchRenameChannel(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.channels() });
      const prev = qc.getQueryData<ChannelsData>(notificationsKeys.channels());
      qc.setQueryData<ChannelsData>(notificationsKeys.channels(), (data) =>
        data
          ? {
              ...data,
              channels: data.channels.map((channel) =>
                channel.id === input.id
                  ? { ...channel, displayName: input.displayName || null }
                  : channel,
              ),
            }
          : data,
      );
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationsKeys.channels(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
    },
  });
}

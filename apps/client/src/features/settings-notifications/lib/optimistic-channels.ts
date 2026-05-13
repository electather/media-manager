import type { QueryClient } from "@tanstack/react-query";

import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import type { ChannelRowData } from "./types";

interface ChannelsData {
  channels: ChannelRowData[];
}

export async function snapshotAndUpdateChannels(
  qc: QueryClient,
  updater: (channels: ChannelRowData[]) => ChannelRowData[],
): Promise<{ prev: ChannelsData | undefined }> {
  await qc.cancelQueries({ queryKey: notificationsKeys.channels() });
  const prev = qc.getQueryData<ChannelsData>(notificationsKeys.channels());
  qc.setQueryData<ChannelsData>(notificationsKeys.channels(), (data) =>
    data ? { ...data, channels: updater(data.channels) } : data,
  );
  return { prev };
}

export function rollbackChannels(qc: QueryClient, prev: ChannelsData | undefined): void {
  if (prev) qc.setQueryData(notificationsKeys.channels(), prev);
}

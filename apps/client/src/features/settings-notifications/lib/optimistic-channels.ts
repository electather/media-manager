import type { QueryClient } from "@tanstack/react-query";

import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import { rollbackQuery, snapshotQuery } from "@/shared/lib/query/optimistic";
import type { ChannelRowData } from "./types";

interface ChannelsData {
  channels: ChannelRowData[];
}

export async function snapshotAndUpdateChannels(
  qc: QueryClient,
  updater: (channels: ChannelRowData[]) => ChannelRowData[],
): Promise<{ prev: ChannelsData | undefined }> {
  return snapshotQuery<ChannelsData>(qc, notificationsKeys.channels(), (data) =>
    data ? { ...data, channels: updater(data.channels) } : data,
  );
}

export function rollbackChannels(qc: QueryClient, prev: ChannelsData | undefined): void {
  if (prev) rollbackQuery(qc, notificationsKeys.channels(), prev);
}

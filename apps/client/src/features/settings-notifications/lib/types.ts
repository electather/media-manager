import type { NotificationCategory } from "@nama/shared/notifications";
import type { PluginSummary } from "@/features/connections";

/**
 * Server-returned shape of `/notifications/plugins`: every notification-capable
 * plugin's full `PluginSummary` plus its `supportsKinds` list. The summary
 * fields let us pass the entry straight to `ConnectionModal` without a second
 * `/connections/available` round-trip.
 */
export type NotificationPluginEntry = PluginSummary & { supportsKinds: string[] };

export interface ChannelRowData {
  id: string;
  pluginId: string;
  displayName: string | null;
  status: string;
  enabled: boolean;
  plugin: { id: string; name: string; version: string };
  displayFields: Array<{ label: string; value: string; mono?: boolean }>;
}

export interface NotifCategory {
  id: NotificationCategory;
  label: string;
  description: string;
  allowed: boolean;
}

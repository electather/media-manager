import type { InferResponseType } from "hono/client";
import type { NotificationCategory } from "@nama/shared/notifications";
import { api } from "@/shared/lib/api";

/**
 * Server-returned shape of `/notifications/plugins`: every notification-capable
 * plugin's full `PluginSummary` plus its `supportsKinds` list. Derived from the
 * Hono client response so a server-side shape change surfaces as a compile
 * error here instead of being hidden behind a cast. The summary fields let us
 * pass the entry straight to `ConnectionModal` without a second
 * `/connections/available` round-trip.
 */
export type NotificationPluginEntry = InferResponseType<
  typeof api.notifications.plugins.$get
>["plugins"][number];

/**
 * Server-returned shape of a `/notifications/channels` row. Derived from the
 * Hono client response so the typed-client guarantee holds end to end.
 */
export type ChannelRowData = InferResponseType<
  typeof api.notifications.channels.$get
>["channels"][number];

export interface NotifCategory {
  id: NotificationCategory;
  label: string;
  description: string;
  allowed: boolean;
}

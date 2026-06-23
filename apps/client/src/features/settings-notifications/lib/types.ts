import type { InferResponseType } from "hono/client";
import type { NotificationCategory } from "@nama/shared/notifications";
import { api } from "@/shared/lib/api";

/** Server shape of `/notifications/plugins`: `PluginSummary` + `supportsKinds`. Derived from Hono client response for compile-time safety (no hidden casts). */
export type NotificationPluginEntry = InferResponseType<
  typeof api.notifications.plugins.$get
>["plugins"][number];

/** Server shape of `/notifications/channels` row, derived from Hono client response for end-to-end type safety. */
export type ChannelRowData = InferResponseType<
  typeof api.notifications.channels.$get
>["channels"][number];

export interface NotifCategory {
  id: NotificationCategory;
  label: string;
  description: string;
  allowed: boolean;
}

import { z } from "zod";
import type { EventName } from "../jobs/events";
import { notificationEventSchema } from "@ent-mcp/shared/notifications";

/**
 * Cross-module events emitted by `plugin-runtime/`. Consumers import the
 * constant and payload schema from `../plugin-runtime` (barrel), never from
 * this file directly.
 */
export const PLUGIN_RUNTIME_EVENTS = {
  NOTIFY_REQUESTED: "plugin-runtime.notify.requested" as EventName,
} as const;

/**
 * Fired when a plugin calls `ctx.notify(event)`. Notifications subscribes and
 * routes the embedded `event` through the standard delivery pipeline.
 */
export const notifyRequestedPayload = z.object({
  pluginId: z.string(),
  event: notificationEventSchema,
});
export type NotifyRequestedPayload = z.infer<typeof notifyRequestedPayload>;

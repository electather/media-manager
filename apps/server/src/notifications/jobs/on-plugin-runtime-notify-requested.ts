import type { NotificationEvent } from "@nama/shared/notifications";
import { on } from "../../jobs/events";
import { PLUGIN_RUNTIME_EVENTS, notifyRequestedPayload } from "../../plugin-runtime";
import { getNotificationsService } from "../service";

/**
 * Routes `ctx.notify(event)` calls through delivery pipeline. Payload's
 * `event` is already a fully-formed `NotificationEvent` (id + occurredAt from
 * `buildHostNotify`); cast avoids re-validating (zod already validated on enqueue).
 */
export function registerOnPluginRuntimeNotifyRequested(): void {
  on(PLUGIN_RUNTIME_EVENTS.NOTIFY_REQUESTED, notifyRequestedPayload, async (payload) => {
    await getNotificationsService().publishNotification(payload.event as NotificationEvent);
  });
}

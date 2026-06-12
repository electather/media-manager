import type { NotificationEvent } from "@nama/shared/notifications";
import { on } from "../../jobs/events";
import { PLUGIN_RUNTIME_EVENTS, notifyRequestedPayload } from "../../plugin-runtime";
import { getNotificationsService } from "../service";

/**
 * Routes plugin-emitted `ctx.notify(event)` calls through the standard
 * delivery pipeline. The payload's `event` field is already a fully-formed
 * `NotificationEvent` (id + occurredAt assigned by `buildHostNotify`); the
 * cast satisfies TypeScript without re-running the schema since zod has
 * already validated the payload on enqueue.
 */
export function registerOnPluginRuntimeNotifyRequested(): void {
  on(PLUGIN_RUNTIME_EVENTS.NOTIFY_REQUESTED, notifyRequestedPayload, async (payload) => {
    await getNotificationsService().publishNotification(payload.event as NotificationEvent);
  });
}

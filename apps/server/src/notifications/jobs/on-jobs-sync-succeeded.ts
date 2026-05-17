import { on } from "../../jobs/events";
import { JOB_EVENTS, jobSyncSucceededPayload } from "../../jobs/runtime-events";
import { getNotificationsService } from "../service";

/**
 * Converts a user-triggered sync-classified job success into a user-audience
 * `connection.sync.succeeded` notification. Cron-fired sync runs do not emit
 * this event because the runner does not include a `triggeredByUserId`.
 */
export function registerOnJobsSyncSucceeded(): void {
  on(JOB_EVENTS.SYNC_SUCCEEDED, jobSyncSucceededPayload, async (payload) => {
    await getNotificationsService().publishNotification({
      type: "connection.sync.succeeded",
      category: "sync",
      severity: "info",
      audience: { kind: "user", userId: payload.triggeredByUserId },
      payload: {
        connectionId: payload.connectionId,
        pluginId: payload.pluginId,
        itemCount: payload.itemCount,
      },
    });
  });
}

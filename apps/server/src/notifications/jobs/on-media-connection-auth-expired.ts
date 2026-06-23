import { on } from "../../jobs/events";
import { MEDIA_EVENTS, connectionAuthExpiredPayload } from "../../media";
import { getNotificationsService } from "../service";

/**
 * Converts media "connection auth expired" event to notification.
 * Import constants from `media` barrel, not deep paths.
 */
export function registerOnMediaConnectionAuthExpired(): void {
  on(MEDIA_EVENTS.CONNECTION_AUTH_EXPIRED, connectionAuthExpiredPayload, async (payload) => {
    await getNotificationsService().publishNotification({
      type: "connection.auth.expired",
      category: "auth",
      severity: "warn",
      audience: { kind: "user", userId: payload.userId },
      payload: { connectionId: payload.connectionId, pluginId: payload.pluginId },
    });
  });
}

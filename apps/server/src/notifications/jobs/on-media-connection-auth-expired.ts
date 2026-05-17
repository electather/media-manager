import { on } from "../../jobs/events";
import { MEDIA_EVENTS, connectionAuthExpiredPayload } from "../../media";
import { getNotificationsService } from "../service";

/**
 * Converts a media-emitted "connection auth expired" event into a user-audience
 * `connection.auth.expired` notification. The constant + payload schema come
 * from the `media` barrel — never `media/events`, which would be a deep
 * import.
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

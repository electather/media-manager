/**
 * Public barrel for `notifications/`. Canonical layout exemplar — the
 * boundaries test asserts re-exports come only from `./service`, `./events`,
 * `./errors`, `./types`, and `./jobs`. `./repo/**`, `./internal/**`,
 * individual handler files in `./jobs/<x>.ts`, and `./templates/**` are
 * deliberately not re-exported.
 */
export {
  NotificationsService,
  getNotificationsService,
  registerNotificationErrorSink,
  resetNotificationsServiceForTest,
} from "./service";
export { NOTIFICATIONS_EVENTS } from "./events";
export { NotificationError, UserConfigParseError } from "./errors";
export type { NotificationSettings, Recipient, NotificationCategory } from "./types";
export { registerJobs } from "./jobs";

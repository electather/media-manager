/** Canonical public barrel: only re-export service, events, errors, types, jobs. Internal repo/**, internal/**, jobs/<x>.ts handlers, and templates/** are NOT exported (fallow-enforced). */
export {
  NotificationsService,
  getNotificationsService,
  registerNotificationErrorSink,
  resetNotificationsServiceForTest,
} from "./service";
export { NOTIFICATIONS_EVENTS } from "./events";
export { NotificationError, UserConfigParseError } from "./errors";
export type { NotificationSettings, Recipient, NotificationCategory } from "./types";
export { registerJobs, type RegisterJobsOptions } from "./jobs";

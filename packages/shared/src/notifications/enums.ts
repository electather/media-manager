import { PERMISSIONS, type Permission } from "../auth";

export const NOTIFICATION_CATEGORIES = ["media", "sync", "auth", "system"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warn", "error"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "succeeded", "failed"] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const NOTIFICATION_CONTENT_KINDS = ["text", "markdown", "image", "actions"] as const;
export type NotificationContentKind = (typeof NOTIFICATION_CONTENT_KINDS)[number];

export const NOTIFICATION_EVENT_TYPES = [
  "job.run.failed",
  "connection.auth.expired",
  "connection.sync.succeeded",
  "media.request.available",
  "media.request.denied",
  "system.error",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_CATEGORY_PERMISSION: Record<NotificationCategory, Permission> = {
  media: PERMISSIONS.MEDIA_ACTIVITY,
  sync: PERMISSIONS.ACCOUNT_CONNECTIONS,
  auth: PERMISSIONS.ACCOUNT_CONNECTIONS,
  system: PERMISSIONS.ADMIN_SERVER,
};

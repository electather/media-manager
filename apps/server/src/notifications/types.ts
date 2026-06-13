import type { NotificationCategory } from "@nama/shared/notifications";

/** Recipient retention configuration; persisted on the `app_config` row. */
export interface NotificationSettings {
  inboxRetentionDays: number;
  deliveryRetentionDays: number;
}

/** Resolved recipient pair used when fanning out a notification event. */
export interface Recipient {
  connectionId: string;
  userId: string;
}

export type { NotificationCategory };

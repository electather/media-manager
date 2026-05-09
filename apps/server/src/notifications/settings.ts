import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { appConfig } from "../db/schema/diagnostics";

const APP_CONFIG_ID = "global";

const DEFAULT_INBOX_RETENTION_DAYS = 90;
const DEFAULT_DELIVERY_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

export interface NotificationSettings {
  inboxRetentionDays: number;
  deliveryRetentionDays: number;
}

function clamp(days: number): number {
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.floor(days)));
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const db = getDb();
  const now = Date.now();
  const row = await db.select().from(appConfig).get();
  if (row) {
    return {
      inboxRetentionDays: row.inboxRetentionDays ?? DEFAULT_INBOX_RETENTION_DAYS,
      deliveryRetentionDays: row.deliveryRetentionDays ?? DEFAULT_DELIVERY_RETENTION_DAYS,
    };
  }
  await db
    .insert(appConfig)
    .values({
      id: APP_CONFIG_ID,
      errorRetentionDays: 30,
      inboxRetentionDays: DEFAULT_INBOX_RETENTION_DAYS,
      deliveryRetentionDays: DEFAULT_DELIVERY_RETENTION_DAYS,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return {
    inboxRetentionDays: DEFAULT_INBOX_RETENTION_DAYS,
    deliveryRetentionDays: DEFAULT_DELIVERY_RETENTION_DAYS,
  };
}

export async function setNotificationSettings(input: {
  inboxRetentionDays?: number;
  deliveryRetentionDays?: number;
}): Promise<NotificationSettings> {
  const db = getDb();
  const current = await getNotificationSettings();
  const next: NotificationSettings = {
    inboxRetentionDays:
      input.inboxRetentionDays !== undefined
        ? clamp(input.inboxRetentionDays)
        : current.inboxRetentionDays,
    deliveryRetentionDays:
      input.deliveryRetentionDays !== undefined
        ? clamp(input.deliveryRetentionDays)
        : current.deliveryRetentionDays,
  };
  await db
    .update(appConfig)
    .set({
      inboxRetentionDays: next.inboxRetentionDays,
      deliveryRetentionDays: next.deliveryRetentionDays,
      updatedAt: Date.now(),
    })
    .where(eq(appConfig.id, APP_CONFIG_ID));
  return next;
}

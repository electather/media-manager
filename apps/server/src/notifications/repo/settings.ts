import { getNotificationRetention, setNotificationRetention } from "../../diagnostics/retention";
import type { NotificationSettings } from "../types";

/**
 * Reads the current notification retention settings via the diagnostics module's
 * accessor, which owns the single-row app_config contract.
 */
export async function getSettings(): Promise<NotificationSettings> {
  return getNotificationRetention();
}

/**
 * Updates notification retention settings via the diagnostics module's
 * accessor so all writes to app_config are serialized through a single owner.
 */
export async function updateSettings(input: {
  inboxRetentionDays?: number;
  deliveryRetentionDays?: number;
}): Promise<NotificationSettings> {
  return setNotificationRetention(input);
}

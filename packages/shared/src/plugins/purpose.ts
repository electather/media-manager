/** Partitions user-scoped plugins: `notificationDelivery`-only → Settings → Notifications; others → Connections; both shapes → both sections. */

export const NOTIFICATION_CAPABILITY_ID = "notificationDelivery";

/** Enum: `none` (no user scopes), `notification` (`notificationDelivery` only), `connection` (other user scopes), `both` (mixed). */
export type PluginPurpose = "none" | "connection" | "notification" | "both";

/**
 * Classifies a plugin from the ids of its user-scoped capabilities.
 */
export function classifyPluginPurpose(userScopedCapabilityIds: readonly string[]): PluginPurpose {
  if (userScopedCapabilityIds.length === 0) return "none";
  const hasNotification = userScopedCapabilityIds.includes(NOTIFICATION_CAPABILITY_ID);
  const hasOther = userScopedCapabilityIds.some((id) => id !== NOTIFICATION_CAPABILITY_ID);
  if (hasNotification && hasOther) return "both";
  if (hasNotification) return "notification";
  return "connection";
}

export function isNotificationOnlyPlugin(userScopedCapabilityIds: readonly string[]): boolean {
  return classifyPluginPurpose(userScopedCapabilityIds) === "notification";
}

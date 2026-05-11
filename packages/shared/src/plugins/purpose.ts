/**
 * Plugin "purpose" classification — partitions user-scoped plugins into the
 * UI section that owns them. A plugin whose only user-scoped capability is
 * `notificationDelivery` lives under Settings → Notifications; anything else
 * lives under Settings → Connections. Plugins with both shapes (notification
 * plus another user-scoped capability) surface in both sections.
 */

export const NOTIFICATION_CAPABILITY_ID = "notificationDelivery";

export type PluginPurpose = "connection" | "notification" | "both";

/**
 * Classifies a plugin from the ids of its user-scoped capabilities. Pure-global
 * plugins (no user-scoped capabilities) are reported as `"connection"`; callers
 * filter them out separately if needed.
 */
export function classifyPluginPurpose(userScopedCapabilityIds: readonly string[]): PluginPurpose {
  if (userScopedCapabilityIds.length === 0) return "connection";
  const hasNotification = userScopedCapabilityIds.includes(NOTIFICATION_CAPABILITY_ID);
  const hasOther = userScopedCapabilityIds.some((id) => id !== NOTIFICATION_CAPABILITY_ID);
  if (hasNotification && hasOther) return "both";
  if (hasNotification) return "notification";
  return "connection";
}

export function isNotificationOnlyPlugin(userScopedCapabilityIds: readonly string[]): boolean {
  return classifyPluginPurpose(userScopedCapabilityIds) === "notification";
}

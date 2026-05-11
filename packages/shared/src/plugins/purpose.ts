/**
 * Plugin "purpose" classification — partitions user-scoped plugins into the
 * UI section that owns them. A plugin whose only user-scoped capability is
 * `notificationDelivery` lives under Settings → Notifications; anything else
 * lives under Settings → Connections. Plugins with both shapes (notification
 * plus another user-scoped capability) surface in both sections.
 */

export const NOTIFICATION_CAPABILITY_ID = "notificationDelivery";

/**
 * - `"none"` — pure-global plugin (no user-scoped capabilities). Neither
 *   the Connections list nor the Notifications picker should offer it.
 * - `"notification"` — only user-scoped capability is `notificationDelivery`.
 *   Owned by Settings → Notifications.
 * - `"connection"` — at least one non-notification user-scoped capability.
 *   Owned by Settings → Connections.
 * - `"both"` — mixes `notificationDelivery` with another user-scoped
 *   capability; surfaces in both sections.
 */
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

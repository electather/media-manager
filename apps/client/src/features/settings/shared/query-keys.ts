export const settingsKeys = {
  all: ["settings"] as const,
  publicConfig: () => [...settingsKeys.all, "public-config"] as const,
  role: () => [...settingsKeys.all, "role"] as const,
  // Notifications tab — picker entries (notification-capable plugins). The
  // channels/categories/subscriptions queries are owned by the notifications
  // feature module under `notificationsKeys`.
  notificationPlugins: () => [...settingsKeys.all, "notifications", "plugins"] as const,
} as const;

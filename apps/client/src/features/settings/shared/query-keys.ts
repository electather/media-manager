export const settingsKeys = {
  all: ["settings"] as const,
  publicConfig: () => [...settingsKeys.all, "public-config"] as const,
  role: () => [...settingsKeys.all, "role"] as const,
  sessions: () => [...settingsKeys.all, "sessions"] as const,
  apps: () => [...settingsKeys.all, "apps"] as const,
  // Connections tab — user's installed connections plus the catalog of
  // plugins they can install.
  connections: () => [...settingsKeys.all, "connections"] as const,
  availablePlugins: () => [...settingsKeys.all, "connections", "available"] as const,
  // Notifications tab — picker entries (notification-capable plugins). The
  // channels/categories/subscriptions queries are owned by the notifications
  // feature module under `notificationsKeys`.
  notificationPlugins: () => [...settingsKeys.all, "notifications", "plugins"] as const,
} as const;

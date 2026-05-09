import type { AdminDeliveryFilters, InboxFilters } from "./types";

export const notificationsKeys = {
  all: ["notifications"] as const,
  unreadCount: () => [...notificationsKeys.all, "unread-count"] as const,
  inbox: (filters: InboxFilters) => [...notificationsKeys.all, "inbox", filters] as const,
  inboxAll: () => [...notificationsKeys.all, "inbox"] as const,
  popoverInbox: (filters: InboxFilters) =>
    [...notificationsKeys.all, "inbox", "popover", filters] as const,
  channels: () => [...notificationsKeys.all, "channels"] as const,
  plugins: () => [...notificationsKeys.all, "plugins"] as const,
  availableConnections: () => [...notificationsKeys.all, "available-connections"] as const,
  categories: () => [...notificationsKeys.all, "categories"] as const,
  subscriptions: () => [...notificationsKeys.all, "subscriptions"] as const,
  admin: {
    deliveries: (filters: AdminDeliveryFilters) =>
      [...notificationsKeys.all, "admin", "deliveries", filters] as const,
    deliveriesAll: () => [...notificationsKeys.all, "admin", "deliveries"] as const,
    delivery: (id: string) => [...notificationsKeys.all, "admin", "delivery", id] as const,
    settings: () => [...notificationsKeys.all, "admin", "settings"] as const,
  },
} as const;

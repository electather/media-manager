import type { NotificationCategory, AdminSettingsBody } from "@ent-mcp/shared/notifications";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";
import { safeJson } from "@/shared/lib/errors/safe-json";
import { NotificationsApiError, type AdminDeliveryFilters, type InboxFilters } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new NotificationsApiError(res.status, body);
}

function inboxQuery(filters: InboxFilters, cursor: string | null) {
  return {
    ...(filters.unreadOnly ? { unreadOnly: "true" as const } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(cursor ? { cursor } : {}),
    limit: "50",
  };
}

export async function fetchInboxPage(filters: InboxFilters, cursor: string | null) {
  const res = await api.notifications.inbox.$get({ query: inboxQuery(filters, cursor) });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchUnreadCount() {
  const res = await api.notifications.inbox["unread-count"].$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchPlugins() {
  const res = await api.notifications.plugins.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchChannels() {
  const res = await api.notifications.channels.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchCategories() {
  const res = await api.notifications.categories.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchSubscriptions() {
  const res = await api.notifications.subscriptions.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchMarkRead(ids: string[]) {
  const res = await api.notifications.inbox["mark-read"].$post({ json: { ids } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchMarkUnread(ids: string[]) {
  const res = await api.notifications.inbox["mark-unread"].$post({ json: { ids } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchMarkAllRead(input: { category?: NotificationCategory }) {
  const res = await api.notifications.inbox["mark-all-read"].$post({
    json: input.category ? { category: input.category } : {},
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchDismiss(ids: string[]) {
  const res = await api.notifications.inbox.$delete({ json: { ids } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchDeleteInboxAll(input: { readOnly?: boolean; olderThan?: string }) {
  const res = await api.notifications.inbox.all.$delete({
    json: {
      ...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
      ...(input.olderThan ? { olderThan: input.olderThan } : {}),
    },
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchToggleSubscription(input: {
  connectionId: string;
  category: NotificationCategory;
  enabled: boolean;
}) {
  const res = await api.notifications.subscriptions[":connectionId"][":category"].$put({
    param: { connectionId: input.connectionId, category: input.category },
    json: { enabled: input.enabled },
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchTestChannel(connectionId: string) {
  const res = await api.notifications.channels[":id"].test.$post({ param: { id: connectionId } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

function adminDeliveriesQuery(filters: AdminDeliveryFilters, cursor: string | null) {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.recipientUserId ? { recipientUserId: filters.recipientUserId } : {}),
    ...(filters.from !== undefined ? { from: String(filters.from) } : {}),
    ...(filters.to !== undefined ? { to: String(filters.to) } : {}),
    ...(cursor ? { cursor } : {}),
    limit: "50",
  };
}

export async function fetchAdminDeliveriesPage(
  filters: AdminDeliveryFilters,
  cursor: string | null,
) {
  const res = await api.admin.notifications.deliveries.$get({
    query: adminDeliveriesQuery(filters, cursor),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchAdminDelivery(id: string) {
  const res = await api.admin.notifications.deliveries[":id"].$get({ param: { id } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchRetryDelivery(id: string) {
  const res = await api.admin.notifications.deliveries[":id"].retry.$post({ param: { id } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchAdminSettings() {
  const res = await api.admin.notifications.settings.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchUpdateAdminSettings(body: AdminSettingsBody) {
  const res = await api.admin.notifications.settings.$patch({ json: body });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

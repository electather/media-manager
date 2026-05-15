import type { NotificationCategory, AdminSettingsBody } from "@ent-mcp/shared/notifications";
import { api } from "@/shared/lib/api";
import { readOkJson, throwOnApiError } from "@/shared/lib/api/throw-on-error";
import { NotificationsApiError, type AdminDeliveryFilters, type InboxFilters } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, NotificationsApiError);

// fallow-ignore-next-line complexity
function inboxQuery(filters: InboxFilters, cursor: string | null, limit = 50) {
  return {
    ...(filters.unreadOnly ? { unreadOnly: "true" as const } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(cursor ? { cursor } : {}),
    limit: String(limit),
  };
}

export async function fetchInboxPage(filters: InboxFilters, cursor: string | null, limit = 50) {
  return readJson(
    await api.notifications.inbox.$get({ query: inboxQuery(filters, cursor, limit) }),
  );
}

export async function fetchInboxAfter(
  cursor: string,
  opts: { unreadOnly?: boolean; limit?: number },
) {
  return readJson(
    await api.notifications.inbox.$get({
      query: {
        after: cursor,
        ...(opts.unreadOnly ? { unreadOnly: "true" as const } : {}),
        limit: String(opts.limit ?? 10),
      },
    }),
  );
}

export async function fetchUnreadCount() {
  return readJson(await api.notifications.inbox["unread-count"].$get());
}

export async function fetchPlugins() {
  return readJson(await api.notifications.plugins.$get());
}

export async function fetchDeleteChannel(id: string) {
  return readJson(await api.connections[":id"].$delete({ param: { id } }));
}

export async function fetchRenameChannel(input: { id: string; displayName: string }) {
  return readJson(
    await api.connections[":id"]["display-name"].$patch({
      param: { id: input.id },
      json: { displayName: input.displayName },
    }),
  );
}

export async function fetchChannels() {
  return readJson(await api.notifications.channels.$get());
}

export async function fetchCategories() {
  return readJson(await api.notifications.categories.$get());
}

export async function fetchSubscriptions() {
  return readJson(await api.notifications.subscriptions.$get());
}

export async function fetchMarkRead(ids: string[]) {
  return readJson(await api.notifications.inbox["mark-read"].$post({ json: { ids } }));
}

export async function fetchMarkUnread(ids: string[]) {
  return readJson(await api.notifications.inbox["mark-unread"].$post({ json: { ids } }));
}

export async function fetchMarkAllRead(input: { category?: NotificationCategory }) {
  return readJson(
    await api.notifications.inbox["mark-all-read"].$post({
      json: input.category ? { category: input.category } : {},
    }),
  );
}

export async function fetchDismiss(ids: string[]) {
  return readJson(await api.notifications.inbox.$delete({ json: { ids } }));
}

export async function fetchDeleteInboxAll(input: { readOnly?: boolean; olderThan?: string }) {
  return readJson(
    await api.notifications.inbox.all.$delete({
      json: {
        ...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
        ...(input.olderThan ? { olderThan: input.olderThan } : {}),
      },
    }),
  );
}

export async function fetchToggleSubscription(input: {
  connectionId: string;
  category: NotificationCategory;
  enabled: boolean;
}) {
  return readJson(
    await api.notifications.subscriptions[":connectionId"][":category"].$put({
      param: { connectionId: input.connectionId, category: input.category },
      json: { enabled: input.enabled },
    }),
  );
}

export async function fetchTestChannel(connectionId: string) {
  const res = await api.notifications.channels[":id"].test.$post({ param: { id: connectionId } });
  if (!res.ok) await throwOnApiError(res, NotificationsApiError);
  // The server endpoint always returns HTTP 200 with `{ ok, message? }` — a
  // failed probe (bad bot token, chat not found, bot blocked) carries
  // `ok: false` plus the plugin's diagnostic. Promote that to a thrown error
  // so `useTestChannel`'s `onSuccess` only fires for genuine successes.
  const body = (await res.json()) as { ok: boolean; message?: string };
  if (!body.ok) {
    throw new NotificationsApiError(200, {
      code: "notifications.test_failed",
      message: body.message ?? "test failed",
    });
  }
  return body;
}

// fallow-ignore-next-line complexity
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
  return readJson(
    await api.admin.notifications.deliveries.$get({
      query: adminDeliveriesQuery(filters, cursor),
    }),
  );
}

export async function fetchAdminDelivery(id: string) {
  return readJson(await api.admin.notifications.deliveries[":id"].$get({ param: { id } }));
}

export async function fetchRetryDelivery(id: string) {
  return readJson(await api.admin.notifications.deliveries[":id"].retry.$post({ param: { id } }));
}

export async function fetchAdminSettings() {
  return readJson(await api.admin.notifications.settings.$get());
}

export async function fetchUpdateAdminSettings(body: AdminSettingsBody) {
  return readJson(await api.admin.notifications.settings.$patch({ json: body }));
}

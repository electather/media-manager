import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "../db/client";
import type {
  NotificationCategory,
  NotificationDeliveryStatus,
  NotificationEventType,
  NotificationSeverity,
} from "@ent-mcp/shared/notifications";
import {
  notificationSubscriptions,
  notificationDeliveries,
  notificationsInbox,
} from "../db/schema/notifications";

// ─── Subscriptions ──────────────────────────────────────────────────────────

export async function getSubscriptions(connectionId: string): Promise<
  Array<{
    connectionId: string;
    category: NotificationCategory;
    enabled: boolean;
  }>
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.connectionId, connectionId))
    .all();
  return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
}

export async function upsertSubscription(
  connectionId: string,
  category: NotificationCategory,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .insert(notificationSubscriptions)
    .values({ connectionId, category, enabled: enabled ? 1 : 0 })
    .onConflictDoUpdate({
      target: [notificationSubscriptions.connectionId, notificationSubscriptions.category],
      set: { enabled: enabled ? 1 : 0 },
    });
}

export async function deleteSubscription(
  connectionId: string,
  category: NotificationCategory,
): Promise<void> {
  const db = getDb();
  await db
    .delete(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.connectionId, connectionId),
        eq(notificationSubscriptions.category, category),
      ),
    );
}

// ─── Deliveries ─────────────────────────────────────────────────────────────

export interface InsertDeliveryInput {
  id: string;
  eventId: string;
  eventType: NotificationEventType;
  eventPayload: string;
  recipientConnectionId: string | null;
  recipientUserId: string;
  status: NotificationDeliveryStatus;
  correlationKey?: string | null;
}

export async function insertDelivery(input: InsertDeliveryInput): Promise<void> {
  const db = getDb();
  const now = Date.now();
  type DeliveryInsert = typeof notificationDeliveries.$inferInsert;
  const values: DeliveryInsert = {
    id: input.id,
    eventId: input.eventId,
    eventType: input.eventType,
    eventPayload: input.eventPayload,
    recipientConnectionId: input.recipientConnectionId,
    recipientUserId: input.recipientUserId,
    status: input.status,
    correlationKey: input.correlationKey ?? null,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(notificationDeliveries).values(values);
}

export async function getDelivery(id: string) {
  const db = getDb();
  return db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)).get();
}

export async function updateDeliveryStatus(
  id: string,
  status: NotificationDeliveryStatus,
  providerMessageId?: string | null,
): Promise<void> {
  const db = getDb();
  type DeliveryUpdate = Partial<typeof notificationDeliveries.$inferInsert>;
  const updates: DeliveryUpdate = { status, updatedAt: Date.now() };
  if (providerMessageId !== undefined) {
    updates.providerMessageId = providerMessageId;
  }
  await db.update(notificationDeliveries).set(updates).where(eq(notificationDeliveries.id, id));
}

export async function recordDeliveryAttempt(
  id: string,
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(notificationDeliveries)
    .set({
      attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
      updatedAt: Date.now(),
      ...(errorCode ? { lastErrorCode: errorCode, lastError: errorMessage ?? null } : {}),
    })
    .where(eq(notificationDeliveries.id, id));
}

// ─── Inbox ──────────────────────────────────────────────────────────────────

export interface InsertInboxItemInput {
  id: string;
  deliveryId: string | null;
  userId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  actionUrl?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

export async function insertInboxItem(input: InsertInboxItemInput): Promise<void> {
  const db = getDb();
  await db.insert(notificationsInbox).values({
    id: input.id,
    deliveryId: input.deliveryId,
    userId: input.userId,
    title: input.title,
    body: input.body,
    severity: input.severity,
    category: input.category,
    actionUrl: input.actionUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    imageAlt: input.imageAlt ?? null,
    readAt: null,
    createdAt: Date.now(),
  });
}

export async function getInboxItem(id: string) {
  const db = getDb();
  return db.select().from(notificationsInbox).where(eq(notificationsInbox.id, id)).get();
}

export async function markInboxRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .update(notificationsInbox)
    .set({ readAt: Date.now() })
    .where(inArray(notificationsInbox.id, ids));
}

export async function markInboxUnread(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .update(notificationsInbox)
    .set({ readAt: null })
    .where(inArray(notificationsInbox.id, ids));
}

export async function deleteInboxItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.delete(notificationsInbox).where(inArray(notificationsInbox.id, ids));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: count() })
    .from(notificationsInbox)
    .where(and(eq(notificationsInbox.userId, userId), isNull(notificationsInbox.readAt)))
    .get();
  return result?.count ?? 0;
}

// ─── Inbox: user-scoped queries (used by HTTP routes) ───────────────────────

export interface InboxListFilters {
  unreadOnly?: boolean;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
}

export interface InboxCursor {
  createdAt: number;
  id: string;
}

export async function listInboxForUser(
  userId: string,
  filters: InboxListFilters,
  cursor: InboxCursor | undefined,
  limit: number,
): Promise<(typeof notificationsInbox.$inferSelect)[]> {
  const db = getDb();
  const conditions = [eq(notificationsInbox.userId, userId)];
  if (filters.unreadOnly) conditions.push(isNull(notificationsInbox.readAt));
  if (filters.category) conditions.push(eq(notificationsInbox.category, filters.category));
  if (filters.severity) conditions.push(eq(notificationsInbox.severity, filters.severity));
  if (cursor) {
    // Keyset: (createdAt, id) < cursor — older rows come after the cursor.
    const tieBreaker = and(
      eq(notificationsInbox.createdAt, cursor.createdAt),
      lt(notificationsInbox.id, cursor.id),
    );
    const keyset = or(lt(notificationsInbox.createdAt, cursor.createdAt), tieBreaker);
    if (keyset) conditions.push(keyset);
  }
  return db
    .select()
    .from(notificationsInbox)
    .where(and(...conditions))
    .orderBy(desc(notificationsInbox.createdAt), desc(notificationsInbox.id))
    .limit(limit)
    .all();
}

export async function markInboxReadForUser(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const result = await db
    .update(notificationsInbox)
    .set({ readAt: Date.now() })
    .where(and(eq(notificationsInbox.userId, userId), inArray(notificationsInbox.id, ids)))
    .returning({ id: notificationsInbox.id });
  return result.length;
}

export async function markInboxUnreadForUser(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const result = await db
    .update(notificationsInbox)
    .set({ readAt: null })
    .where(and(eq(notificationsInbox.userId, userId), inArray(notificationsInbox.id, ids)))
    .returning({ id: notificationsInbox.id });
  return result.length;
}

export async function markAllReadForUser(
  userId: string,
  category?: NotificationCategory,
): Promise<number> {
  const db = getDb();
  const conditions = [eq(notificationsInbox.userId, userId), isNull(notificationsInbox.readAt)];
  if (category) conditions.push(eq(notificationsInbox.category, category));
  const result = await db
    .update(notificationsInbox)
    .set({ readAt: Date.now() })
    .where(and(...conditions))
    .returning({ id: notificationsInbox.id });
  return result.length;
}

export async function deleteInboxForUser(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const result = await db
    .delete(notificationsInbox)
    .where(and(eq(notificationsInbox.userId, userId), inArray(notificationsInbox.id, ids)))
    .returning({ id: notificationsInbox.id });
  return result.length;
}

export async function deleteInboxAllForUser(
  userId: string,
  opts: { readOnly?: boolean; olderThanMs?: number },
): Promise<number> {
  const db = getDb();
  const conditions = [eq(notificationsInbox.userId, userId)];
  if (opts.readOnly) conditions.push(isNotNull(notificationsInbox.readAt));
  if (opts.olderThanMs !== undefined) {
    conditions.push(lte(notificationsInbox.createdAt, opts.olderThanMs));
  }
  const result = await db
    .delete(notificationsInbox)
    .where(and(...conditions))
    .returning({ id: notificationsInbox.id });
  return result.length;
}

// ─── Subscriptions (joined with user's connections) ────────────────────────

export async function listSubscriptionsForConnections(
  connectionIds: string[],
): Promise<Array<{ connectionId: string; category: NotificationCategory; enabled: boolean }>> {
  if (connectionIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(notificationSubscriptions)
    .where(inArray(notificationSubscriptions.connectionId, connectionIds))
    .all();
  return rows.map((r) => ({
    connectionId: r.connectionId,
    category: r.category,
    enabled: r.enabled === 1,
  }));
}

// ─── Deliveries: admin queries ──────────────────────────────────────────────

export interface DeliveryListFilters {
  status?: NotificationDeliveryStatus;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  recipientUserId?: string;
  from?: number;
  to?: number;
}

export interface DeliveryCursor {
  createdAt: number;
  id: string;
}

export async function listDeliveries(
  filters: DeliveryListFilters,
  cursor: DeliveryCursor | undefined,
  limit: number,
): Promise<(typeof notificationDeliveries.$inferSelect)[]> {
  const db = getDb();
  const conditions = [];
  if (filters.status) conditions.push(eq(notificationDeliveries.status, filters.status));
  if (filters.recipientUserId) {
    conditions.push(eq(notificationDeliveries.recipientUserId, filters.recipientUserId));
  }
  if (filters.from !== undefined) {
    conditions.push(gte(notificationDeliveries.createdAt, filters.from));
  }
  if (filters.to !== undefined) {
    conditions.push(lte(notificationDeliveries.createdAt, filters.to));
  }
  if (cursor) {
    const tieBreaker = and(
      eq(notificationDeliveries.createdAt, cursor.createdAt),
      lt(notificationDeliveries.id, cursor.id),
    );
    const keyset = or(lt(notificationDeliveries.createdAt, cursor.createdAt), tieBreaker);
    if (keyset) conditions.push(keyset);
  }
  // Note: category/severity live inside `event_payload` JSON. For v1 we filter
  // post-query when those are supplied; if dashboards become hot we add
  // generated columns or denormalise.
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(notificationDeliveries)
    .where(where)
    .orderBy(desc(notificationDeliveries.createdAt), desc(notificationDeliveries.id))
    .limit(limit * 2)
    .all();
  if (!filters.category && !filters.severity) return rows.slice(0, limit);
  const out = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    try {
      const event = JSON.parse(row.eventPayload) as {
        category?: NotificationCategory;
        severity?: NotificationSeverity;
      };
      if (filters.category && event.category !== filters.category) continue;
      if (filters.severity && event.severity !== filters.severity) continue;
    } catch {
      continue;
    }
    out.push(row);
  }
  return out;
}

export async function resetDeliveryForRetry(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      attemptCount: 0,
      lastError: null,
      lastErrorCode: null,
      updatedAt: Date.now(),
    })
    .where(eq(notificationDeliveries.id, id))
    .returning({ id: notificationDeliveries.id });
  return result.length > 0;
}

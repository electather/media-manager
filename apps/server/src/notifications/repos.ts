import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import type {
  NotificationCategory,
  NotificationDeliveryStatus,
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
    enabled: number;
  }>
> {
  const db = getDb();
  return db
    .select()
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.connectionId, connectionId))
    .all();
}

export async function upsertSubscription(
  connectionId: string,
  category: NotificationCategory,
  enabled: number,
): Promise<void> {
  const db = getDb();
  await db
    .insert(notificationSubscriptions)
    .values({ connectionId, category, enabled })
    .onConflictDoUpdate({
      target: [notificationSubscriptions.connectionId, notificationSubscriptions.category],
      set: { enabled },
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
  eventType: string;
  eventPayload: string;
  recipientConnectionId: string | null;
  recipientUserId: string;
  status: NotificationDeliveryStatus;
  correlationKey?: string | null;
}

export async function insertDelivery(input: InsertDeliveryInput): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const values: any = {
    id: input.id,
    eventId: input.eventId,
    eventType: input.eventType,
    eventPayload: input.eventPayload,
    recipientConnectionId: input.recipientConnectionId,
    recipientUserId: input.recipientUserId,
    status: input.status,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (input.correlationKey) {
    values.correlationKey = input.correlationKey;
  }
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
  const updates: any = { status, updatedAt: Date.now() };
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
  const current = await getDelivery(id);
  if (!current) return;
  const updates: any = {
    attemptCount: current.attemptCount + 1,
    updatedAt: Date.now(),
  };
  if (errorCode) {
    updates.lastErrorCode = errorCode;
    updates.lastError = errorMessage ?? null;
  }
  await db.update(notificationDeliveries).set(updates).where(eq(notificationDeliveries.id, id));
}

// ─── Inbox ──────────────────────────────────────────────────────────────────

export interface InsertInboxItemInput {
  id: string;
  deliveryId: string | null;
  userId: string;
  title: string;
  body: string;
  severity: string;
  category: string;
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
  const db = getDb();
  await db
    .update(notificationsInbox)
    .set({ readAt: Date.now() })
    .where(inArray(notificationsInbox.id, ids));
}

export async function markInboxUnread(ids: string[]): Promise<void> {
  const db = getDb();
  await db
    .update(notificationsInbox)
    .set({ readAt: null })
    .where(inArray(notificationsInbox.id, ids));
}

export async function deleteInboxItems(ids: string[]): Promise<void> {
  const db = getDb();
  await db.delete(notificationsInbox).where(inArray(notificationsInbox.id, ids));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select()
    .from(notificationsInbox)
    .where(and(eq(notificationsInbox.userId, userId), isNull(notificationsInbox.readAt)))
    .all();
  return result.length;
}

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import { getDb } from "../../db/client";
import { notificationsInbox } from "../../db/schema/notifications";
import type {
  InboxItemDto,
  NotificationCategory,
  NotificationSeverity,
} from "@nama/shared/notifications";

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

export interface InboxListFilters {
  unreadOnly?: boolean;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
}

export interface InboxCursor {
  createdAt: number;
  id: string;
}

// fallow-ignore-next-line complexity
export async function listInboxForUser(
  userId: string,
  filters: InboxListFilters,
  cursor: InboxCursor | undefined,
  limit: number,
  opts: { direction?: "before" | "after" } = {},
): Promise<(typeof notificationsInbox.$inferSelect)[]> {
  const db = getDb();
  const direction = opts.direction ?? "before";
  const conditions = [eq(notificationsInbox.userId, userId)];
  if (filters.unreadOnly) conditions.push(isNull(notificationsInbox.readAt));
  if (filters.category) conditions.push(eq(notificationsInbox.category, filters.category));
  if (filters.severity) conditions.push(eq(notificationsInbox.severity, filters.severity));
  if (cursor) {
    if (direction === "after") {
      const tieBreaker = and(
        eq(notificationsInbox.createdAt, cursor.createdAt),
        gt(notificationsInbox.id, cursor.id),
      );
      const keyset = or(gt(notificationsInbox.createdAt, cursor.createdAt), tieBreaker);
      if (keyset) conditions.push(keyset);
    } else {
      const tieBreaker = and(
        eq(notificationsInbox.createdAt, cursor.createdAt),
        lt(notificationsInbox.id, cursor.id),
      );
      const keyset = or(lt(notificationsInbox.createdAt, cursor.createdAt), tieBreaker);
      if (keyset) conditions.push(keyset);
    }
  }
  return db
    .select()
    .from(notificationsInbox)
    .where(and(...conditions))
    .orderBy(
      direction === "after"
        ? asc(notificationsInbox.createdAt)
        : desc(notificationsInbox.createdAt),
      direction === "after" ? asc(notificationsInbox.id) : desc(notificationsInbox.id),
    )
    .limit(limit)
    .all();
}

async function setInboxReadAtForUser(
  userId: string,
  ids: string[],
  readAt: number | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const result = await db
    .update(notificationsInbox)
    .set({ readAt })
    .where(and(eq(notificationsInbox.userId, userId), inArray(notificationsInbox.id, ids)))
    .returning({ id: notificationsInbox.id });
  return result.length;
}

export async function markInboxReadForUser(userId: string, ids: string[]): Promise<number> {
  return setInboxReadAtForUser(userId, ids, Date.now());
}

export async function markInboxUnreadForUser(userId: string, ids: string[]): Promise<number> {
  return setInboxReadAtForUser(userId, ids, null);
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

export function inboxRowToDto(row: typeof notificationsInbox.$inferSelect): InboxItemDto {
  return {
    id: row.id,
    createdAt: row.createdAt,
    readAt: row.readAt,
    title: row.title,
    body: row.body,
    severity: row.severity,
    category: row.category,
    actionUrl: row.actionUrl,
    image:
      row.imageUrl !== null
        ? { url: row.imageUrl, ...(row.imageAlt ? { alt: row.imageAlt } : {}) }
        : null,
  };
}

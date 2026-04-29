import { consola } from "consola";
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
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "../db/client";
import type {
  NotificationCategory,
  NotificationDeliveryStatus,
  NotificationEventType,
  NotificationSeverity,
  AdminDeliveryRow,
  InboxItemDto,
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

/**
 * Records a failed-but-retryable attempt and reschedules it. Single update so
 * the row is never visible in an "attempt recorded but not yet rescheduled"
 * state to a concurrent reader. Status flips back to `pending` so the sweep
 * (or a direct trigger after the delay elapses) can pick it up; the CAS in
 * the delivery handler enforces the `nextAttemptAt <= now` gate before
 * actually starting the retry.
 */
export async function rescheduleDeliveryAttempt(
  id: string,
  nextAttemptAt: number,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
      lastErrorCode: errorCode,
      lastError: errorMessage,
      nextAttemptAt,
      updatedAt: Date.now(),
    })
    .where(eq(notificationDeliveries.id, id));
}

/**
 * Marks a delivery as terminally failed and stamps the final error metadata.
 * `nextAttemptAt` is cleared so admin/sweep tooling never reschedules a row
 * that the cap has retired.
 */
export async function markDeliveryFailed(
  id: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(notificationDeliveries)
    .set({
      status: "failed",
      lastErrorCode: errorCode,
      lastError: errorMessage,
      attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
      nextAttemptAt: null,
      updatedAt: Date.now(),
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

// fallow-ignore-next-line complexity
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

// We over-fetch by `OVERFETCH_RATIO × limit` rows when category/severity
// filters apply because those fields live inside the JSON `event_payload`
// and must be checked after the query runs. The ratio is a heuristic: too
// low and the post-filter starves the response; too high and we waste IO.
// 2× is fine for v1 admin volume. Promote the fields to generated columns
// or a denormalised dashboard if pagination gaps become user-visible.
// TODO(notifications): denormalise category/severity onto
// notification_deliveries when admin volume grows.
const DELIVERY_LIST_OVERFETCH_RATIO = 2;

function buildDeliveryFilterPredicate(filters: DeliveryListFilters): SQL[] {
  const conditions: SQL[] = [];
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
  return conditions;
}

function buildDeliveryKeysetPredicate(cursor: DeliveryCursor): SQL | undefined {
  // Older rows come AFTER the cursor in `desc(createdAt), desc(id)` order:
  // (createdAt, id) < (cursor.createdAt, cursor.id).
  const tieBreaker = and(
    eq(notificationDeliveries.createdAt, cursor.createdAt),
    lt(notificationDeliveries.id, cursor.id),
  );
  return or(lt(notificationDeliveries.createdAt, cursor.createdAt), tieBreaker);
}

function deliveryEventTags(
  row: typeof notificationDeliveries.$inferSelect,
): { category?: NotificationCategory; severity?: NotificationSeverity } | "unparsable" {
  try {
    return JSON.parse(row.eventPayload) as {
      category?: NotificationCategory;
      severity?: NotificationSeverity;
    };
  } catch (err) {
    // A row with corrupt JSON is invisible to the admin filter, which
    // hides the data integrity issue. Surface it so ops can investigate.
    consola.warn(
      `notifications: delivery ${row.id} has unparsable event_payload, skipping during filtered list: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "unparsable";
  }
}

// fallow-ignore-next-line complexity
function applyEventPayloadFilters(
  rows: (typeof notificationDeliveries.$inferSelect)[],
  filters: Pick<DeliveryListFilters, "category" | "severity">,
  limit: number,
): (typeof notificationDeliveries.$inferSelect)[] {
  if (!filters.category && !filters.severity) return rows.slice(0, limit);
  const out: (typeof notificationDeliveries.$inferSelect)[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    const tags = deliveryEventTags(row);
    if (tags === "unparsable") continue;
    if (filters.category && tags.category !== filters.category) continue;
    if (filters.severity && tags.severity !== filters.severity) continue;
    out.push(row);
  }
  return out;
}

// fallow-ignore-next-line complexity
export async function listDeliveries(
  filters: DeliveryListFilters,
  cursor: DeliveryCursor | undefined,
  limit: number,
): Promise<(typeof notificationDeliveries.$inferSelect)[]> {
  const conditions = buildDeliveryFilterPredicate(filters);
  if (cursor) {
    const keyset = buildDeliveryKeysetPredicate(cursor);
    if (keyset) conditions.push(keyset);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const fetchLimit =
    filters.category || filters.severity ? limit * DELIVERY_LIST_OVERFETCH_RATIO : limit;
  const rows = await getDb()
    .select()
    .from(notificationDeliveries)
    .where(where)
    .orderBy(desc(notificationDeliveries.createdAt), desc(notificationDeliveries.id))
    .limit(fetchLimit)
    .all();
  return applyEventPayloadFilters(rows, filters, limit);
}

// ─── Row → DTO mappers (shared between HTTP handlers and tests) ─────────────

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

export function deliveryRowToDto(
  row: typeof notificationDeliveries.$inferSelect,
): AdminDeliveryRow {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    recipientConnectionId: row.recipientConnectionId,
    recipientUserId: row.recipientUserId,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    providerMessageId: row.providerMessageId,
    correlationKey: row.correlationKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Result of an admin-triggered retry. `in_progress` shields rows currently
 * in flight from being flipped back to pending, which would double-deliver
 * because the delivery handler can't abort an active plugin call. The admin
 * can retry once the in-flight attempt has settled. */
export type RetryResetResult = "reset" | "in_progress" | "not_found";

export async function resetDeliveryForRetry(id: string): Promise<RetryResetResult> {
  const db = getDb();
  // Atomic conditional update — single statement so a concurrent transition
  // of the row from `pending`/`failed`/`succeeded` to `in_progress` cannot
  // slip between a check and the write. Drizzle's `returning` lets us tell
  // whether the predicate matched without a separate read.
  const updated = await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      attemptCount: 0,
      lastError: null,
      lastErrorCode: null,
      updatedAt: Date.now(),
    })
    .where(and(eq(notificationDeliveries.id, id), ne(notificationDeliveries.status, "in_progress")))
    .returning({ id: notificationDeliveries.id });
  if (updated.length > 0) return "reset";
  // No row updated: either the id is unknown or the row is in_progress.
  // Disambiguate with a single follow-up SELECT — runs only on the
  // miss path so the happy case stays at one query.
  const existing = await db
    .select({ status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.id, id))
    .get();
  if (!existing) return "not_found";
  return "in_progress";
}

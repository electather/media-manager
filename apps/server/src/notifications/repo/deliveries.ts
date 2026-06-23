import { randomUUID } from "node:crypto";
import { consola } from "consola";
import { and, desc, eq, gte, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../db/client";
import type {
  NotificationCategory,
  NotificationDeliveryStatus,
  NotificationEvent,
  NotificationSeverity,
  AdminDeliveryRow,
} from "@nama/shared/notifications";
import { notificationDeliveries } from "../../db/schema/notifications";
import type { Recipient } from "../types";

/**
 * Atomically inserts one delivery row per recipient for a single event. Returns
 * the generated delivery ids in insertion order so the caller can dispatch the
 * delivery job per row. Runs in a single transaction so a partial failure does
 * not leave a half-fanned-out event in the queue.
 */
export async function createDeliveriesForEvent(
  event: NotificationEvent,
  recipients: ReadonlyArray<Recipient>,
): Promise<string[]> {
  const db = getDb();
  const deliveryIds: string[] = [];
  const eventPayload = JSON.stringify(event);
  await db.transaction(async (tx) => {
    const values = recipients.map((r) => {
      const id = randomUUID();
      deliveryIds.push(id);
      return {
        id,
        eventId: event.id,
        eventType: event.type,
        eventPayload,
        recipientConnectionId: r.connectionId,
        recipientUserId: r.userId,
        status: "pending" as const,
        attemptCount: 0,
        correlationKey: event.correlationKey ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    await tx.insert(notificationDeliveries).values(values);
  });
  return deliveryIds;
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

// Single update prevents intermediate state visible to concurrent readers.
// Status → `pending` for sweep pickup; delivery handler enforces `nextAttemptAt <= now` gate.
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

// Over-fetch heuristic when category/severity filters apply because those
// fields live inside the JSON `event_payload` and must be checked after the
// query runs. 2× is fine for v1 admin volume; promote to generated columns
// or a dashboard denorm if pagination gaps become user-visible.
const DELIVERY_LIST_OVERFETCH_RATIO = 2;

// fallow-ignore-next-line complexity
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
  // slip between a check and the write.
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
  const existing = await db
    .select({ status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.id, id))
    .get();
  if (!existing) return "not_found";
  return "in_progress";
}

// Atomic CAS: `pending` → `in_progress` only when backoff window is open (nextAttemptAt <= now).
// Deduplicates sweep retriggers; missing/in-flight/delayed rows return null.
export async function claimPendingForInProgress(deliveryId: string) {
  const db = getDb();
  const now = Date.now();
  return db
    .update(notificationDeliveries)
    .set({ status: "in_progress", nextAttemptAt: null, updatedAt: now })
    .where(
      and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, "pending"),
        or(
          isNull(notificationDeliveries.nextAttemptAt),
          lte(notificationDeliveries.nextAttemptAt, now),
        ),
      ),
    )
    .returning()
    .get();
}

// Sweep-eligible: pending rows with expired backoff or stale with no nextAttemptAt,
// plus old in-progress rows (likely crashed mid-flight).
export async function listSweepEligible(
  now: number,
  staleCutoff: number,
  limit: number,
): Promise<Array<{ id: string; status: string }>> {
  const db = getDb();
  return db
    .select({ id: notificationDeliveries.id, status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(
      or(
        and(
          eq(notificationDeliveries.status, "pending"),
          lte(notificationDeliveries.nextAttemptAt, now),
        ),
        and(
          eq(notificationDeliveries.status, "pending"),
          isNull(notificationDeliveries.nextAttemptAt),
          lt(notificationDeliveries.updatedAt, staleCutoff),
        ),
        and(
          eq(notificationDeliveries.status, "in_progress"),
          lt(notificationDeliveries.updatedAt, staleCutoff),
        ),
      ),
    )
    .limit(limit)
    .all();
}

/** Resets a crashed-mid-flight `in_progress` row back to `pending` so the next sweep tick can pick it up. */
export async function resetInProgressToPending(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(notificationDeliveries)
    .set({ status: "pending", nextAttemptAt: null, updatedAt: Date.now() })
    .where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.status, "in_progress")))
    .run();
}

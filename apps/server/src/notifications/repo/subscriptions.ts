import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client";
import { notificationSubscriptions } from "../../db/schema/notifications";
import type { NotificationCategory } from "@nama/shared/notifications";

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

/**
 * Returns connection ids with `category` subscribed (enabled = 1).
 * Used by resolve-recipients to finalize delivery set after plugin-runtime narrowing.
 */
export async function listEnabledSubscriptions(
  connectionIds: ReadonlyArray<string>,
  category: NotificationCategory,
): Promise<Set<string>> {
  if (connectionIds.length === 0) return new Set();
  const db = getDb();
  const rows = await db
    .select({ connectionId: notificationSubscriptions.connectionId })
    .from(notificationSubscriptions)
    .where(
      and(
        inArray(notificationSubscriptions.connectionId, connectionIds as string[]),
        eq(notificationSubscriptions.category, category),
        eq(notificationSubscriptions.enabled, 1),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.connectionId));
}

/** Auto-create a category subscription as enabled if missing. Used by the demo job. */
export async function ensureSubscription(
  connectionId: string,
  category: NotificationCategory,
): Promise<void> {
  const db = getDb();
  await db
    .insert(notificationSubscriptions)
    .values({ connectionId, category, enabled: 1 })
    .onConflictDoNothing({
      target: [notificationSubscriptions.connectionId, notificationSubscriptions.category],
    });
}

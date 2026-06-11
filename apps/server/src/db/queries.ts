import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { plugins, serviceConnections } from "./schema";

export async function selectEnabledPlugins() {
  const db = getDb();
  return db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
}

export async function queryEnabledConnectionsForPlugin(db: Db, userId: string, pluginId: string) {
  return db
    .select()
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.pluginId, pluginId),
        eq(serviceConnections.enabled, 1),
      ),
    )
    .orderBy(desc(serviceConnections.isDefault), desc(serviceConnections.createdAt))
    .all();
}

/**
 * Parks a connection on rate-limit cooldown. Stamps `lastExhaustedAt` with the
 * current epoch second and sets `retryAfter` that many seconds in the future so
 * the ready-now filter skips the connection until the window passes.
 */
export async function markConnectionExhausted(
  connectionId: string,
  retryAfterSec = 60,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(serviceConnections)
    .set({
      lastExhaustedAt: now,
      retryAfter: now + retryAfterSec,
      updatedAt: Date.now(),
    })
    .where(eq(serviceConnections.id, connectionId));
}

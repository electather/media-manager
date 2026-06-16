import { consola } from "consola";
import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { plugins, serviceConnections } from "./schema";

export async function selectEnabledPlugins() {
  const db = getDb();
  return db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
}

/**
 * Parses the stored `serviceConnections.userConfig` JSON text column. Returns
 * `null` on a missing value or malformed JSON rather than propagating a raw
 * `SyntaxError`, so a single corrupt row degrades to "no user config" instead
 * of throwing a 500 across every read path (connections list, media dispatch,
 * targeted dispatch, plugin jobs, MCP calls). `null` is already a valid value
 * for these callers — a row that never had a userConfig produces the same
 * result — so degrading to it is safe.
 */
export function parseUserConfig(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    // A corrupt row is a real data-integrity signal — degrade to null so reads
    // don't 500, but surface the failure so operators can locate the bad row.
    consola.warn("Failed to parse serviceConnections.userConfig; treating as empty", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
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

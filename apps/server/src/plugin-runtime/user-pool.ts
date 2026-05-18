import { consola } from "consola";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { attempt } from "es-toolkit/util";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema/credentials";
import { decryptJson } from "../crypto/helpers";

export interface UserConnectionPick {
  connectionId: string;
  isDefault: boolean;
  credentials: unknown;
  userConfig: unknown;
}

/**
 * Ready-now enabled connections for a user+plugin, default-first. Entries with
 * a future `retry_after` are filtered out. Callers still need to gracefully
 * handle empty results.
 */
export async function listReadyUserConnections(
  userId: string,
  pluginId: string,
): Promise<UserConnectionPick[]> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select()
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.pluginId, pluginId),
        eq(serviceConnections.enabled, 1),
        or(isNull(serviceConnections.retryAfter), lte(serviceConnections.retryAfter, now)),
      ),
    )
    .orderBy(desc(serviceConnections.isDefault), desc(serviceConnections.createdAt))
    .all();

  const picks: UserConnectionPick[] = [];
  for (const row of rows) {
    let userConfig: unknown = null;
    const raw = row.userConfig;
    if (raw) {
      const [err, parsed] = attempt(() => JSON.parse(raw));
      if (err) {
        consola.warn(`[user-pool] malformed userConfig row id=${row.id}, skipping`, err);
        continue;
      }
      userConfig = parsed;
    }
    picks.push({
      connectionId: row.id,
      isDefault: row.isDefault === 1,
      credentials: await decryptJson(row.credentialsIv, row.encryptedCredentials),
      userConfig,
    });
  }
  return picks;
}

export async function markUserConnectionExhausted(
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

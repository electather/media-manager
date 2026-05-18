import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
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
    let credentials: unknown;
    try {
      credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
    } catch (err) {
      // Corrupt ciphertext (tampered bytes, wrong key, truncated base64) — skip
      // this row rather than aborting the whole pool lookup so remaining valid
      // connections are still tried.
      console.warn(
        `[user-pool] skipping connection ${row.id}: decryptJson threw`,
        err,
      );
      continue;
    }
    if (credentials === null) {
      // Skip rows with no stored ciphertext (null iv or data). A null result
      // means no credentials were ever written; passing null to the plugin
      // would produce a silent unauthenticated invocation.
      console.warn(
        `[user-pool] skipping connection ${row.id}: decryptJson returned null`,
      );
      continue;
    }
    picks.push({
      connectionId: row.id,
      isDefault: row.isDefault === 1,
      credentials,
      userConfig: row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null,
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

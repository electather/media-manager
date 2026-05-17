import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema/credentials";
import { encryptJson } from "../crypto/helpers";

/**
 * Public shape of a `service_connections` row returned to other modules. Mirrors
 * the columns notifications/media need; leaves the encrypted credentials
 * material in place so callers that already pass through `decryptJson` keep
 * working.
 */
export interface ConnectionRow {
  id: string;
  userId: string;
  pluginId: string;
  userConfig: string | null;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
}

/** Returns a single connection by id, or `null` if not found. */
export async function getConnectionById(id: string): Promise<ConnectionRow | null> {
  const db = getDb();
  const row = await db
    .select({
      id: serviceConnections.id,
      userId: serviceConnections.userId,
      pluginId: serviceConnections.pluginId,
      userConfig: serviceConnections.userConfig,
      encryptedCredentials: serviceConnections.encryptedCredentials,
      credentialsIv: serviceConnections.credentialsIv,
    })
    .from(serviceConnections)
    .where(eq(serviceConnections.id, id))
    .get();
  return row ?? null;
}

/**
 * Returns enabled connections for the given user ids. Used by `notifications`
 * during recipient resolution; the caller intersects with its subscription
 * filter to land on the final delivery set.
 */
export async function listEnabledConnectionsForUsers(
  userIds: readonly string[],
): Promise<Array<{ id: string; userId: string; pluginId: string }>> {
  if (userIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      id: serviceConnections.id,
      userId: serviceConnections.userId,
      pluginId: serviceConnections.pluginId,
    })
    .from(serviceConnections)
    .where(and(inArray(serviceConnections.userId, userIds), eq(serviceConnections.enabled, 1)))
    .all();
}

/**
 * Ensures the user has a host-managed `inbox` connection and returns its id.
 * Idempotent under concurrent triggers — the read+insert run in a transaction
 * and the select is ordered by createdAt+id so callers always get the same
 * canonical row when multiple exist from prior data states.
 */
export async function ensureInboxConnection(userId: string): Promise<string> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, userId), eq(serviceConnections.pluginId, "inbox")))
      .orderBy(asc(serviceConnections.createdAt), asc(serviceConnections.id))
      .get();
    if (existing) return existing.id;
    const id = randomUUID();
    const now = Date.now();
    const credEnc = await encryptJson({ kind: "inbox" });
    await tx.insert(serviceConnections).values({
      id,
      userId,
      pluginId: "inbox",
      status: "connected",
      enabled: 1,
      isDefault: 0,
      displayName: "Inbox",
      encryptedCredentials: credEnc.data,
      credentialsIv: credEnc.iv,
      userConfig: null,
      tokenExpiresAt: null,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

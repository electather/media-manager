import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { primaryConnections, serviceConnections } from "../db/schema";

const NO_MEDIA_TYPE = "_";

function normalizeMediaType(mediaType: string | null | undefined): string {
  return mediaType ?? NO_MEDIA_TYPE;
}

function primaryConnectionWhere(userId: string, capabilityKey: string, mediaType: string) {
  return and(
    eq(primaryConnections.userId, userId),
    eq(primaryConnections.capabilityKey, capabilityKey),
    eq(primaryConnections.mediaType, mediaType),
  );
}

/**
 * Returns the user's stored primary connection for a capability, or `null` when none
 * is set. Resolves the backing `service_connections` row so the caller can dispatch
 * directly against it.
 */
export async function getPrimaryConnection(args: {
  userId: string;
  capabilityKey: string;
  mediaType?: string | null;
}): Promise<{ connectionId: string; pluginId: string } | null> {
  const db = getDb();
  const row = await db
    .select({
      connectionId: primaryConnections.connectionId,
      pluginId: serviceConnections.pluginId,
      enabled: serviceConnections.enabled,
    })
    .from(primaryConnections)
    .innerJoin(serviceConnections, eq(primaryConnections.connectionId, serviceConnections.id))
    .where(
      primaryConnectionWhere(args.userId, args.capabilityKey, normalizeMediaType(args.mediaType)),
    )
    .get();
  if (!row || row.enabled !== 1) return null;
  return { connectionId: row.connectionId, pluginId: row.pluginId };
}

export async function setPrimaryConnection(args: {
  userId: string;
  capabilityKey: string;
  mediaType?: string | null;
  connectionId: string;
}): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const mediaType = normalizeMediaType(args.mediaType);
  const existing = await db
    .select({ connectionId: primaryConnections.connectionId })
    .from(primaryConnections)
    .where(primaryConnectionWhere(args.userId, args.capabilityKey, mediaType))
    .get();
  if (existing) {
    await db
      .update(primaryConnections)
      .set({ connectionId: args.connectionId, updatedAt: now })
      .where(primaryConnectionWhere(args.userId, args.capabilityKey, mediaType));
  } else {
    await db.insert(primaryConnections).values({
      userId: args.userId,
      capabilityKey: args.capabilityKey,
      mediaType,
      connectionId: args.connectionId,
      updatedAt: now,
    });
  }
}

export async function clearPrimaryConnection(args: {
  userId: string;
  capabilityKey: string;
  mediaType?: string | null;
}): Promise<void> {
  const db = getDb();
  await db
    .delete(primaryConnections)
    .where(
      primaryConnectionWhere(args.userId, args.capabilityKey, normalizeMediaType(args.mediaType)),
    );
}

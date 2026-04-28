import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { primaryConnections, serviceConnections } from "../db/schema";

const NO_MEDIA_TYPE = "_";

function normalizeMediaType(mediaType: string | null | undefined): string {
  return mediaType ?? NO_MEDIA_TYPE;
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
      and(
        eq(primaryConnections.userId, args.userId),
        eq(primaryConnections.capabilityKey, args.capabilityKey),
        eq(primaryConnections.mediaType, normalizeMediaType(args.mediaType)),
      ),
    )
    .get();
  if (!row || row.enabled !== 1) return null;
  return { connectionId: row.connectionId, pluginId: row.pluginId };
}

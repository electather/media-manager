import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { plugins, serviceConnections } from "../db/schema";
import { decryptField } from "../crypto/helpers";

/**
 * A connection materialized for dispatch. Either comes from a user-owned
 * `service_connections` row or from the plugin-level shared credentials blob.
 */
export type ResolvedConnection =
  | {
      kind: "user";
      pluginId: string;
      connectionId: string;
      isDefault: boolean;
      credentials: unknown;
      userConfig: unknown;
    }
  | {
      kind: "shared";
      pluginId: string;
      /** Sentinel connectionId so invocation outcomes can carry a stable identifier. */
      connectionId: null;
      credentials: unknown;
      userConfig: null;
    };

async function getSharedCredentials(pluginId: string): Promise<unknown | null> {
  const db = getDb();
  const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
  if (!row) return null;
  if (row.sharedCredentials && row.sharedCredentialsIv) {
    return decryptField(row.sharedCredentialsIv, row.sharedCredentials);
  }
  return null;
}

/**
 * Resolves every connection a user can use for a given plugin, in dispatch order:
 *   1. Enabled user connections (default first, then others by createdAt desc).
 *   2. Shared credentials, if the plugin allows them AND the user has no personal connection.
 */
export async function resolveConnections(
  userId: string,
  pluginId: string,
): Promise<ResolvedConnection[]> {
  const db = getDb();
  const rows = await db
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

  const userConnections: ResolvedConnection[] = [];
  for (const row of rows) {
    userConnections.push({
      kind: "user",
      pluginId: row.pluginId,
      connectionId: row.id,
      isDefault: row.isDefault === 1,
      credentials: await decryptField(row.credentialsIv, row.encryptedCredentials),
      userConfig: row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null,
    });
  }
  if (userConnections.length > 0) return userConnections;

  const shared = await getSharedCredentials(pluginId);
  if (shared !== null && shared !== undefined) {
    return [
      {
        kind: "shared",
        pluginId,
        connectionId: null,
        credentials: shared,
        userConfig: null,
      },
    ];
  }
  return [];
}

/** Resolves just the default/single connection, preferring personal → shared. */
export async function resolveDefaultConnection(
  userId: string,
  pluginId: string,
): Promise<ResolvedConnection | null> {
  const all = await resolveConnections(userId, pluginId);
  return all[0] ?? null;
}

import { and, eq, inArray } from "drizzle-orm";
import { capabilityRegistry } from "../../plugin-runtime";
import { getDb } from "../../db/client";
// TASK-045: catalog reads serviceConnections via plugin-runtime/preferences barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { serviceConnections } from "../../db/schema/plugin-runtime/credentials";

export interface SyncRow {
  userId: string;
  pluginId: string;
}

/**
 * Every active service connection whose plugin contributes watchHistory@v1 or ratings@v1.
 * Disabled/pending-auth connections skipped — sync runs only against dispatcher-accepted credentials.
 */
export async function listSyncRows(): Promise<SyncRow[]> {
  const historyProviders = capabilityRegistry.listProviders("watchHistory", "v1", "user");
  const ratingsProviders = capabilityRegistry.listProviders("ratings", "v1", "user");
  const wantedPluginIds = Array.from(new Set([...historyProviders, ...ratingsProviders]));
  if (wantedPluginIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .selectDistinct({ userId: serviceConnections.userId, pluginId: serviceConnections.pluginId })
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.enabled, 1),
        eq(serviceConnections.status, "connected"),
        inArray(serviceConnections.pluginId, wantedPluginIds),
      ),
    );
  return rows.map((row) => ({ userId: row.userId, pluginId: row.pluginId }));
}

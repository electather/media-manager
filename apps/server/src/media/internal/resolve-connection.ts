import { getDb } from "../../db/client";
import { queryEnabledConnectionsForPlugin } from "../../db/queries";
import { decryptField } from "../../crypto/helpers";
import { sharedCredentialsService } from "../../plugin-runtime";

/**
 * A connection materialized for dispatch. Either comes from a user-owned
 * `service_connections` row or from an admin-configured shared-credentials
 * pool entry.
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

/**
 * Resolves every connection a user can use for a given plugin, in dispatch order:
 *   1. Enabled user connections (default first, then others by createdAt desc).
 *   2. Any admin shared-credential entry, used only when the user has no
 *      personal connection.
 */
// fallow-ignore-next-line complexity
export async function resolveConnections(
  userId: string,
  pluginId: string,
): Promise<ResolvedConnection[]> {
  const rows = await queryEnabledConnectionsForPlugin(getDb(), userId, pluginId);

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

  const shared = await sharedCredentialsService.listDecryptedActive(pluginId);
  if (shared.length === 0) return [];
  return [
    {
      kind: "shared",
      pluginId,
      connectionId: null,
      credentials: shared[0]!.value,
      userConfig: null,
    },
  ];
}

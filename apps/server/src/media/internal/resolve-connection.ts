import type { ResolvedCapabilityScope } from "@nama/plugin-sdk";
import { getDb } from "../../db/client";
import { parseUserConfig, queryEnabledConnectionsForPlugin } from "../../db/queries";
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
 * Resolves in order: (1) enabled user connections (default first, then createdAt desc),
 * (2) admin shared credentials (only if no user connections AND scope is `global`).
 * Shared credentials fail for `user` scope (calendar, watchlist) → downgrade to `all_failed`.
 */
// fallow-ignore-next-line complexity
export async function resolveConnections(
  userId: string,
  pluginId: string,
  scope: ResolvedCapabilityScope,
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
      userConfig: parseUserConfig(row.userConfig, row.id),
    });
  }
  if (userConnections.length > 0) return userConnections;
  if (scope === "user") return [];

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

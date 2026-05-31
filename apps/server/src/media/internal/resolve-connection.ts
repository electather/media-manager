import type { ResolvedCapabilityScope } from "@ent-mcp/plugin-sdk";
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
 *      personal connection AND the request is `global`-scoped.
 *
 * The shared-credential entry carries the admin's app/OAuth identity (e.g.
 * Trakt's `clientId`/`clientSecret`), never a per-user access token. It can
 * therefore only satisfy a `global`-scoped capability. For a `user`-scoped
 * capability (calendar, watchlist, ratings, libraryAvailability, …) the
 * upstream needs the requesting user's own credentials, so a shared-only
 * candidate would always fail auth — and, being the same identity for every
 * user, could never return correct per-user data anyway. Surfacing it would
 * make the dispatcher "attempt" a provider that can only error, downgrading a
 * row to `all_failed` (e.g. the `calendar@v1` "coming up" row 503) instead of
 * dropping cleanly. So the fallback is gated on `scope === "global"`.
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
      userConfig: row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null,
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

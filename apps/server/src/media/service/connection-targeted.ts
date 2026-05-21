import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
// TASK-047: media reads serviceConnections via plugin-runtime barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { serviceConnections } from "../../db/schema/plugin-runtime/credentials";
import { decryptField } from "../../crypto/helpers";
import { capabilityRegistry, pluginRuntime } from "../../plugin-runtime";
import { getCapability } from "@ent-mcp/plugin-sdk";
import { PluginCallError, normalizeError } from "../errors";
import type { ResolvedConnection } from "../internal/resolve-connection";

export interface EligibleConnection {
  connectionId: string;
  pluginId: string;
  pluginName: string | null;
  displayName: string | null;
  isDefault: boolean;
}

/**
 * Lists every user-owned connection that provides a given capability, ordered
 * default-first. Returns an empty array when no connections exist — callers
 * that want `mcp.not_connected` handling decide based on the length.
 */
export async function listEligibleConnections(
  userId: string,
  capability: string,
  version: string,
): Promise<EligibleConnection[]> {
  // Connection-targeted dispatch is exclusively for user-scoped writes; only
  // plugins that implement the capability at `scope: "user"` are eligible.
  const providers = capabilityRegistry.listProviders(capability, version, "user");
  if (providers.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(serviceConnections)
    .where(and(eq(serviceConnections.userId, userId), eq(serviceConnections.enabled, 1)))
    .orderBy(desc(serviceConnections.isDefault), desc(serviceConnections.createdAt))
    .all();

  const providerSet = new Set(providers);
  const out: EligibleConnection[] = [];
  for (const row of rows) {
    if (!providerSet.has(row.pluginId)) continue;
    out.push({
      connectionId: row.id,
      pluginId: row.pluginId,
      pluginName: null,
      displayName: row.displayName,
      isDefault: row.isDefault === 1,
    });
  }
  return out;
}

async function loadConnectionById(
  userId: string,
  connectionId: string,
): Promise<ResolvedConnection | null> {
  const db = getDb();
  const row = await db
    .select()
    .from(serviceConnections)
    .where(and(eq(serviceConnections.id, connectionId), eq(serviceConnections.userId, userId)))
    .get();
  if (!row || row.enabled !== 1) return null;
  return {
    kind: "user",
    pluginId: row.pluginId,
    connectionId: row.id,
    isDefault: row.isDefault === 1,
    credentials: await decryptField(row.credentialsIv, row.encryptedCredentials),
    userConfig: row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null,
  };
}

export interface TargetedDispatchRequest {
  userId: string;
  connectionId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
}

/**
 * Invokes a capability method against a specific user connection, bypassing
 * the default-picker. No retry/refresh wrapper here — targeted dispatch is
 * exclusively used by MCP writes that want explicit routing.
 */
// fallow-ignore-next-line complexity
export async function dispatchToConnection<T>(req: TargetedDispatchRequest): Promise<T | null> {
  const capability = getCapability(req.capability, req.version);
  if (!capability) {
    throw new PluginCallError(
      "plugin.missing_method",
      `unknown capability ${req.capability}@${req.version}`,
      "",
      req.connectionId,
    );
  }
  const conn = await loadConnectionById(req.userId, req.connectionId);
  if (!conn || conn.kind !== "user") {
    throw new PluginCallError(
      "mcp.target_not_found",
      `connection ${req.connectionId} not found or disabled`,
      "",
      req.connectionId,
    );
  }
  const providers = capabilityRegistry.listProviders(req.capability, req.version, "user");
  if (!providers.includes(conn.pluginId)) {
    throw new PluginCallError(
      "mcp.target_not_found",
      `connection ${req.connectionId} does not support ${req.capability}@${req.version}`,
      conn.pluginId,
      req.connectionId,
    );
  }
  try {
    return (
      (await pluginRuntime.invokeWithCredentials<T>({
        pluginId: conn.pluginId,
        capability: req.capability,
        version: req.version,
        method: req.method,
        input: req.input,
        userId: req.userId,
        credentials: conn.credentials,
        userConfig: conn.userConfig,
      })) ?? null
    );
  } catch (err) {
    const normalized = normalizeError(err);
    throw new PluginCallError(
      normalized.code,
      normalized.devMessage,
      conn.pluginId,
      conn.connectionId,
    );
  }
}

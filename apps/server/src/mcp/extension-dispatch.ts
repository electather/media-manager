import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { parseUserConfig, queryEnabledConnectionsForPlugin } from "../db/queries";
import { serviceConnections } from "../db/schema";
import { decryptField } from "../crypto/helpers";
import { pluginRuntime } from "../plugin-runtime";
import { notConnected } from "./errors";

export interface ExtensionCallRequest {
  userId: string;
  pluginId: string;
  handlerKey: string;
  input: unknown;
  /** Optional specific connection. Falls back to default-first for the user. */
  connectionId?: string;
}

interface ConnectionRow {
  id: string;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
  userConfig: string | null;
}

async function pickConnectionForPlugin(
  userId: string,
  pluginId: string,
): Promise<ConnectionRow | null> {
  const rows = await queryEnabledConnectionsForPlugin(getDb(), userId, pluginId);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    encryptedCredentials: row.encryptedCredentials,
    credentialsIv: row.credentialsIv,
    userConfig: row.userConfig,
  };
}

async function loadSpecificConnection(
  userId: string,
  connectionId: string,
  pluginId: string,
): Promise<ConnectionRow | null> {
  const db = getDb();
  const row = await db
    .select()
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.id, connectionId),
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.pluginId, pluginId),
      ),
    )
    .get();
  if (!row || row.enabled !== 1) return null;
  return {
    id: row.id,
    encryptedCredentials: row.encryptedCredentials,
    credentialsIv: row.credentialsIv,
    userConfig: row.userConfig,
  };
}

/**
 * Resolves the user's connection for a plugin, decrypts the credentials, and
 * hands the input to the plugin's `mcpTools[handlerKey]`. Throws
 * `mcp.not_connected` when there is no connection; other failures bubble up
 * as `PluginError`.
 */
export async function callExtension<T = unknown>(req: ExtensionCallRequest): Promise<T> {
  const chosen = req.connectionId
    ? await loadSpecificConnection(req.userId, req.connectionId, req.pluginId)
    : await pickConnectionForPlugin(req.userId, req.pluginId);
  if (!chosen) throw notConnected(req.pluginId);

  const credentials = await decryptField(chosen.credentialsIv, chosen.encryptedCredentials);
  const userConfig = parseUserConfig(chosen.userConfig);

  return pluginRuntime.invokeMcpTool<T>({
    pluginId: req.pluginId,
    handlerKey: req.handlerKey,
    input: req.input,
    userId: req.userId,
    credentials,
    userConfig,
  });
}

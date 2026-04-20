import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { plugins, primaryConnections, serviceConnections } from "../../db/schema";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import { CAPABILITY_CATALOG, type CapabilityKey } from "../../plugin-runtime/capabilities";
import type { ToolHandler, ToolRegistration } from "../registry";

interface ConnectionView {
  id: string;
  plugin_id: string;
  plugin_name: string | null;
  display_name: string | null;
  status: "connected" | "expired" | "error" | "disconnected";
  enabled: boolean;
  capabilities: string[];
  is_default_for_capability: string[];
  error_message?: string;
}

interface EntAccountResponse {
  connections: ConnectionView[];
  missing_capabilities: string[];
}

function capabilitiesForPlugin(pluginId: string): string[] {
  const entry = capabilityRegistry.get(pluginId);
  if (!entry) return [];
  return Object.entries(entry.module.manifest.capabilities).map(
    ([id, version]) => `${id}@${version}`,
  );
}

function listKnownCapabilities(): string[] {
  return (Object.keys(CAPABILITY_CATALOG) as CapabilityKey[]).filter(
    (key) => key !== "idResolve@v1",
  );
}

async function pluginNameMap(pluginIds: string[]): Promise<Map<string, string | null>> {
  if (pluginIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db.select().from(plugins).all();
  const out = new Map<string, string | null>();
  for (const row of rows) {
    if (!pluginIds.includes(row.id)) continue;
    try {
      const manifest = JSON.parse(row.manifest) as { displayName?: string; name?: string };
      out.set(row.id, manifest.displayName ?? manifest.name ?? row.id);
    } catch {
      out.set(row.id, row.id);
    }
  }
  return out;
}

async function primaryConnectionKeysFor(userId: string, connectionId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ capabilityKey: primaryConnections.capabilityKey })
    .from(primaryConnections)
    .where(
      and(eq(primaryConnections.userId, userId), eq(primaryConnections.connectionId, connectionId)),
    )
    .all();
  return [...new Set(rows.map((r) => r.capabilityKey))];
}

export const entAccountHandler: ToolHandler = async (ctx) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(serviceConnections)
    .where(eq(serviceConnections.userId, ctx.userId))
    .all();

  const names = await pluginNameMap(rows.map((r) => r.pluginId));

  const providedCapabilities = new Set<string>();
  const connections: ConnectionView[] = [];

  for (const row of rows) {
    const caps = capabilitiesForPlugin(row.pluginId);
    for (const cap of caps) providedCapabilities.add(cap);
    const primaryKeys = await primaryConnectionKeysFor(ctx.userId, row.id);
    const view: ConnectionView = {
      id: row.id,
      plugin_id: row.pluginId,
      plugin_name: names.get(row.pluginId) ?? null,
      display_name: row.displayName,
      status: row.status,
      enabled: row.enabled === 1,
      capabilities: caps,
      is_default_for_capability: caps.filter((cap) => primaryKeys.includes(cap)),
    };
    if (row.errorMessage) view.error_message = row.errorMessage;
    connections.push(view);
  }

  const known = listKnownCapabilities();
  const missing = known.filter((cap) => !providedCapabilities.has(cap));

  const response: EntAccountResponse = {
    connections,
    missing_capabilities: missing,
  };
  return response;
};

export const entAccountRegistration: Omit<ToolRegistration, "source"> & { id: string } = {
  id: "ent_account",
  name: "ent_account",
  description: "List your connected services, their status, and what they provide.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      connections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            plugin_id: { type: "string" },
            plugin_name: { type: ["string", "null"] },
            display_name: { type: ["string", "null"] },
            status: {
              type: "string",
              enum: ["connected", "expired", "error", "disconnected"],
            },
            enabled: { type: "boolean" },
            capabilities: { type: "array", items: { type: "string" } },
            is_default_for_capability: { type: "array", items: { type: "string" } },
            error_message: { type: "string" },
          },
          required: [
            "id",
            "plugin_id",
            "plugin_name",
            "display_name",
            "status",
            "enabled",
            "capabilities",
            "is_default_for_capability",
          ],
          additionalProperties: false,
        },
      },
      missing_capabilities: { type: "array", items: { type: "string" } },
    },
    required: ["connections", "missing_capabilities"],
    additionalProperties: false,
  },
  requiredScopes: ["mcp.read"],
  annotations: { readOnlyHint: true },
  handler: entAccountHandler,
};

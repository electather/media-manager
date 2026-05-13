import type { ConnectionListItem, PluginSummary } from "@ent-mcp/shared/connections";
import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { SettingsConnectionsApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, SettingsConnectionsApiError);

export async function fetchConnections(): Promise<ConnectionListItem[]> {
  const body = (await readJson(await api.connections.$get())) as {
    connections: ConnectionListItem[];
  };
  return body.connections;
}

export async function fetchAvailablePlugins(): Promise<PluginSummary[]> {
  const body = (await readJson(await api.connections.available.$get())) as {
    plugins: PluginSummary[];
  };
  return body.plugins;
}

export async function fetchTestConnection(id: string): Promise<{ ok: boolean; message?: string }> {
  const body = (await readJson(await api.connections[":id"].test.$post({ param: { id } }))) as {
    ok: boolean;
    message?: string;
  };

  if (!body.ok) throw new Error(body.message ?? "Test failed");
  return body;
}

export async function fetchToggleConnectionEnabled(input: {
  id: string;
  enabled: boolean;
}): Promise<void> {
  await readJson(
    await api.connections[":id"].enabled.$patch({
      param: { id: input.id },
      json: { enabled: input.enabled },
    }),
  );
}

export async function fetchSetDefaultConnection(id: string): Promise<void> {
  await readJson(await api.connections[":id"].default.$post({ param: { id } }));
}

export async function fetchDeleteConnection(id: string): Promise<void> {
  await readJson(await api.connections[":id"].$delete({ param: { id } }));
}

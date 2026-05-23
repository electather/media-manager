import type {
  ConnectionListItem,
  PluginSummary,
  PrimaryConnectionRow,
} from "@ent-mcp/shared/connections";
import type { MediaType } from "@ent-mcp/shared/media";
import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { SettingsConnectionsApiError } from "./types";
import { invariant } from "es-toolkit";

const readJson = <R extends Response>(res: R) => readOkJson(res, SettingsConnectionsApiError);

export async function fetchConnections(): Promise<ConnectionListItem[]> {
  const body = await readJson(await api.connections.$get());
  return body.connections;
}

export async function fetchAvailablePlugins(): Promise<PluginSummary[]> {
  const body = await readJson(await api.connections.available.$get());
  return body.plugins;
}

export async function fetchTestConnection(id: string): Promise<{ ok: boolean; message?: string }> {
  const body = await readJson(await api.connections[":id"].test.$post({ param: { id } }));
  invariant(body.ok, body.message ?? "Test failed");
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

export async function fetchPrimaryConnections(): Promise<PrimaryConnectionRow[]> {
  const body = await readJson(await api.connections.primary.$get());
  return body.primaries;
}

export async function fetchSetPrimaryConnection(input: {
  capabilityKey: string;
  mediaType: MediaType | null;
  connectionId: string;
}): Promise<void> {
  await readJson(await api.connections.primary.$post({ json: input }));
}

export async function fetchClearPrimaryConnection(input: {
  capabilityKey: string;
  mediaType: MediaType | null;
}): Promise<void> {
  await readJson(await api.connections.primary.$delete({ json: input }));
}

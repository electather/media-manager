import type {
  ConnectionListItem,
  PluginSummary,
  PrimaryConnectionRow,
} from "@nama/shared/connections";
import type { MediaType } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { SettingsConnectionsApiError } from "./types";

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
  // Return the full { ok, message } result so that callers can distinguish
  // between a successful test, a failed test (ok: false), and a transport
  // error (thrown by readJson). This avoids embedding English fallback strings
  // in the data layer and lets the mutation hook decide how to surface the
  // connection's updated status regardless of the test outcome.
  return readJson(await api.connections[":id"].test.$post({ param: { id } }));
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

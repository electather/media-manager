import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";

import { ConnectionsApiError } from "./types";

/**
 * Centralised connections API calls, per the frontend-feature-architecture
 * hard rule 2: no `api.*` access in components. Most are thin wrappers that
 * return the Hono `Response` so the connection modal can keep its existing
 * typed-error routing — the form-save and verify paths read the body even on
 * a non-OK status to surface field-level errors, so those wrappers
 * deliberately do not throw on `!res.ok`. The device-poll wrapper carries no
 * field errors, so it throws the typed `ConnectionsApiError` on HTTP failure
 * (hard rule 3) and returns the parsed status envelope.
 */

type DevicePollResult =
  | { status: "pending" }
  | { status: "completed"; connectionId: string }
  | { status: "error"; message: string };

export function getUserConfig(id: string): Promise<Response> {
  return api.connections[":id"]["user-config"].$get({ param: { id } });
}

export function verifyConfig(input: {
  pluginId: string;
  userConfig: Record<string, unknown>;
}): Promise<Response> {
  return api.connections["verify-config"].$post({ json: input });
}

export function createConnection(input: {
  pluginId: string;
  userConfig: Record<string, unknown>;
  displayName: string | undefined;
}): Promise<Response> {
  return api.connections.$post({ json: input });
}

export function patchUserConfig(input: {
  id: string;
  userConfig: Record<string, unknown>;
}): Promise<Response> {
  return api.connections[":id"]["user-config"].$patch({
    param: { id: input.id },
    json: { userConfig: input.userConfig },
  });
}

export function patchDisplayName(input: { id: string; displayName: string }): Promise<Response> {
  return api.connections[":id"]["display-name"].$patch({
    param: { id: input.id },
    json: { displayName: input.displayName },
  });
}

export function startDeviceAuth(pluginId: string): Promise<Response> {
  return api.connections.oauth.device.start.$post({ json: { pluginId } });
}

export async function pollDeviceAuth(nonce: string): Promise<DevicePollResult> {
  const res = await api.connections.oauth.device.poll.$post({ json: { nonce } });
  return (await readOkJson(res, ConnectionsApiError)) satisfies DevicePollResult;
}

export function startRedirectAuth(pluginId: string): Promise<Response> {
  return api.connections.oauth.redirect.start.$post({ json: { pluginId } });
}

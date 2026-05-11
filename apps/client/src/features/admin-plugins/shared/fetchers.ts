import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";
import { api } from "@/shared/lib/api";
import { readOkJson, throwOnApiError } from "@/shared/lib/api/throw-on-error";
import { AdminPluginsApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, AdminPluginsApiError);

export async function fetchPluginsList() {
  return readJson(await api.plugins.$get());
}

export async function fetchSetEnabled(input: { pluginId: string; enabled: boolean }) {
  return readJson(
    await api.plugins[":id"].enabled.$patch({
      param: { id: input.pluginId },
      json: { enabled: input.enabled },
    }),
  );
}

export async function fetchGlobalConfig(pluginId: string) {
  return readJson(await api.plugins[":id"]["global-config"].$get({ param: { id: pluginId } }));
}

export async function fetchSaveGlobalConfig(input: {
  pluginId: string;
  config: Record<string, unknown>;
}) {
  return readJson(
    await api.plugins[":id"]["global-config"].$put({
      param: { id: input.pluginId },
      json: { config: input.config },
    }),
  );
}

export async function fetchSetFallback(input: {
  pluginId: string;
  policy: PersonalKeyFallbackPolicy;
}) {
  return readJson(
    await api.plugins[":id"]["personal-key-fallback"].$patch({
      param: { id: input.pluginId },
      json: { policy: input.policy },
    }),
  );
}

export async function fetchSetAdminAllowlist(input: {
  pluginId: string;
  allowlist: string[] | null;
}) {
  return readJson(
    await api.plugins[":id"]["admin-allowlist"].$put({
      param: { id: input.pluginId },
      json: { allowlist: input.allowlist },
    }),
  );
}

export async function fetchUpsertAdminHeader(input: {
  pluginId: string;
  name: string;
  value: string;
}) {
  return readJson(
    await api.plugins[":id"]["admin-headers"].$put({
      param: { id: input.pluginId },
      json: { headers: { [input.name]: input.value } },
    }),
  );
}

export async function fetchDeleteAdminHeader(input: { pluginId: string; name: string }) {
  return readJson(
    await api.plugins[":id"]["admin-headers"].$put({
      param: { id: input.pluginId },
      json: { headers: { [input.name]: null } },
    }),
  );
}

export async function fetchUninstallPlugin(pluginId: string) {
  const res = await api.plugins[":id"].$delete({ param: { id: pluginId } });
  if (!res.ok) await throwOnApiError(res, AdminPluginsApiError);
  return res.json();
}

import type { AuthorizedApp, PublicConfig } from "@ent-mcp/shared/users";

import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";

import { SettingsAppsApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, SettingsAppsApiError);

export async function fetchPublicConfig(): Promise<PublicConfig> {
  return (await readJson(await api.config.public.$get())) as PublicConfig;
}

export async function fetchAuthorizedApps(): Promise<AuthorizedApp[]> {
  return (await readJson(await api.me.apps.$get())) as AuthorizedApp[];
}

export async function revokeAuthorizedApp(clientId: string): Promise<AuthorizedApp[]> {
  const body = await readJson(await api.me.apps[":clientId"].revoke.$post({ param: { clientId } }));
  return body.apps;
}

import type { AuthorizedApp } from "@nama/shared/users";

import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";

import { SettingsAppsApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, SettingsAppsApiError);

export { fetchPublicConfig } from "@/features/settings/shared/fetchers";

export async function fetchAuthorizedApps(): Promise<AuthorizedApp[]> {
  return await readJson(await api.me.apps.$get());
}

export async function revokeAuthorizedApp(clientId: string): Promise<AuthorizedApp[]> {
  const body = await readJson(await api.me.apps[":clientId"].revoke.$post({ param: { clientId } }));
  return body.apps;
}

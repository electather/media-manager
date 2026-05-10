import type { AuthorizedApp, PublicConfig, RoleSummary } from "@ent-mcp/shared/users";
import type { DeleteAccountBody } from "@ent-mcp/shared/users";
import { api } from "@/shared/lib/api";
import { throwOnApiError } from "@/shared/lib/api/throw-on-error";
import { SettingsApiError } from "./types";

const throwOnError = (res: Response) => throwOnApiError(res, SettingsApiError);

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await api.config.public.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as PublicConfig;
}

export async function fetchRole(): Promise<{ role: RoleSummary | null }> {
  const res = await api.me.role.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as { role: RoleSummary | null };
}

export async function fetchAuthorizedApps(): Promise<AuthorizedApp[]> {
  const res = await api.me.apps.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as AuthorizedApp[];
}

export async function revokeAuthorizedApp(clientId: string): Promise<AuthorizedApp[]> {
  const res = await api.me.apps[":clientId"].revoke.$post({ param: { clientId } });
  if (!res.ok) await throwOnError(res);
  const body = (await res.json()) as { ok: true; apps: AuthorizedApp[] };
  return body.apps;
}

export async function deleteAccount(body: DeleteAccountBody): Promise<void> {
  const res = await api.me.delete.$post({ json: body });
  if (!res.ok) await throwOnError(res);
}

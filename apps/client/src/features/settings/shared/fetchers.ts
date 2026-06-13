import type { PublicConfig, RoleSummary } from "@nama/shared/users";
import type { DeleteAccountBody } from "@nama/shared/users";
import { api } from "@/shared/lib/api";
import { readOkJson, throwOnApiError } from "@/shared/lib/api/throw-on-error";
import { SettingsApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, SettingsApiError);

export async function fetchPublicConfig(): Promise<PublicConfig> {
  return (await readJson(await api.config.public.$get())) as PublicConfig;
}

export async function fetchRole(): Promise<{ role: RoleSummary | null }> {
  return (await readJson(await api.me.role.$get())) as { role: RoleSummary | null };
}

export async function deleteAccount(body: DeleteAccountBody): Promise<void> {
  // `deleteAccount` returns no body; only the throw-on-error half of the
  // helper is relevant, so we route through `throwOnApiError` directly to
  // avoid an unused `res.json()` parse.
  const res = await api.me.delete.$post({ json: body });
  if (!res.ok) await throwOnApiError(res, SettingsApiError);
}

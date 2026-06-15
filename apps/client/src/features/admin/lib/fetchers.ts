import type { PersonalKeyFallbackPolicy } from "@nama/shared/plugins";
import { api } from "@/shared/lib/api";
import { readOkJson, throwOnApiError } from "@/shared/lib/api/throw-on-error";
import { AdminApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, AdminApiError);

// ─── Shared credentials ───────────────────────────────────────────────────────

/** Lists all shared credential entries for a plugin. */
export async function fetchSharedCredentials(pluginId: string) {
  return readJson(await api.plugins[":id"]["shared-credentials"].$get({ param: { id: pluginId } }));
}

/** Creates a new shared credential entry. */
export async function fetchCreateSharedCredential(input: {
  pluginId: string;
  label: string;
  value: Record<string, unknown>;
}) {
  return readJson(
    await api.plugins[":id"]["shared-credentials"].$post({
      param: { id: input.pluginId },
      json: { label: input.label, value: input.value },
    }),
  );
}

/** Partially updates a shared credential entry. */
export async function fetchPatchSharedCredential(input: {
  pluginId: string;
  credId: string;
  patch: { label?: string; value?: unknown; enabled?: boolean };
}) {
  const res = await api.plugins[":id"]["shared-credentials"][":credId"].$patch({
    param: { id: input.pluginId, credId: input.credId },
    json: input.patch,
  });
  if (!res.ok) await throwOnApiError(res, AdminApiError);
  return res.json();
}

/** Deletes a shared credential entry. */
export async function fetchDeleteSharedCredential(input: { pluginId: string; credId: string }) {
  const res = await api.plugins[":id"]["shared-credentials"][":credId"].$delete({
    param: { id: input.pluginId, credId: input.credId },
  });
  if (!res.ok) await throwOnApiError(res, AdminApiError);
}

/** Tests the persisted value of an existing shared credential. */
export async function fetchTestSharedCredentialPersisted(input: {
  pluginId: string;
  credId: string;
}) {
  const res = await api.plugins[":id"]["shared-credentials"][":credId"].test.$post({
    param: { id: input.pluginId, credId: input.credId },
  });
  if (!res.ok) await throwOnApiError(res, AdminApiError);
  return res.json() as Promise<{ ok: boolean; message?: string }>;
}

/** Tests an unsaved credential value via the ephemeral endpoint. */
export async function fetchTestSharedCredentialEphemeral(input: {
  pluginId: string;
  value: Record<string, unknown>;
}) {
  return readJson(
    await api.plugins[":id"]["shared-credentials"]["test-ephemeral"].$post({
      param: { id: input.pluginId },
      json: { value: input.value },
    }),
  );
}

// ─── Personal-key fallback ────────────────────────────────────────────────────

/** Sets the personal-key fallback policy for a plugin. */
export async function fetchSetFallbackPolicy(input: {
  pluginId: string;
  policy: PersonalKeyFallbackPolicy;
}) {
  const res = await api.plugins[":id"]["personal-key-fallback"].$patch({
    param: { id: input.pluginId },
    json: { policy: input.policy },
  });
  if (!res.ok) await throwOnApiError(res, AdminApiError);
}

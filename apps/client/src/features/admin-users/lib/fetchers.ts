import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { AdminUsersApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, AdminUsersApiError);

export async function fetchAdminUsers() {
  return readJson(await api.admin.users.$get());
}

// No cast — the return type flows from Hono's inferred res.json() via readOkJson
// so the compiler can detect server-side shape changes at the call sites.
export async function fetchAdminUser(id: string) {
  return readJson(await api.admin.users[":id"].$get({ param: { id } }));
}

export async function fetchAssignRole(id: string, roleId: string) {
  return readJson(await api.admin.users[":id"].role.$put({ param: { id }, json: { roleId } }));
}

export async function fetchRevokeSessions(id: string) {
  return readJson(await api.admin.users[":id"]["revoke-sessions"].$post({ param: { id } }));
}

export async function fetchDeleteUser(id: string) {
  return readJson(await api.admin.users[":id"].$delete({ param: { id } }));
}

// ─── Invite fetchers ──────────────────────────────────────────────────────────

export async function fetchInvites() {
  return readJson(await api.admin.invites.$get());
}

export async function createInvite(json: { roleId: string; expiresAt: number; maxUses: number }) {
  return readJson(await api.admin.invites.$post({ json }));
}

export async function extendInvite(id: string, expiresAt: number) {
  return readJson(
    await api.admin.invites[":id"].extend.$post({ param: { id }, json: { expiresAt } }),
  );
}

export async function revokeInvite(id: string) {
  return readJson(await api.admin.invites[":id"].$delete({ param: { id } }));
}

// ─── Public invite fetchers (used by the accept page) ────────────────────────

/**
 * Fetches the invite preview for the given code. Returns null on 404 (invite
 * not found) and throws with status 410 on expired/exhausted/revoked.
 */
export async function fetchInvitePreview(
  code: string,
): Promise<{ roleName: string; expiresAt: number } | null | "gone"> {
  const res = await api.invites[":code"].$get({ param: { code } });
  if (res.status === 404) return null;
  if (res.status === 410) return "gone";
  if (!res.ok) await readJson(res);
  return res.json() as Promise<{ roleName: string; expiresAt: number }>;
}

export async function acceptInvite(
  code: string,
  json: { name: string; email: string; password: string },
) {
  return readJson(await api.invites[":code"].accept.$post({ param: { code }, json }));
}

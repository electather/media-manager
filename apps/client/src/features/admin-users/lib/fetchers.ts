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

// ─── Admin Invites ─────────────────────────────────────────────────────────────

export async function fetchInvites() {
  return readJson(await api.admin.invites.$get());
}

export async function createInvite(input: { roleId: string; expiresAt: number; maxUses: string }) {
  return readJson(
    await api.admin.invites.$post({
      json: { roleId: input.roleId, expiresAt: input.expiresAt, maxUses: Number(input.maxUses) },
    }),
  );
}

export async function extendInvite(id: string, expiresAt: number) {
  return readJson(
    await api.admin.invites[":id"].extend.$post({ param: { id }, json: { expiresAt } }),
  );
}

export async function revokeInvite(id: string) {
  return readJson(await api.admin.invites[":id"].$delete({ param: { id } }));
}

// ─── Public Invites (accept page) ─────────────────────────────────────────────

export async function fetchInvitePreview(code: string) {
  return readJson(await api.invites[":code"].$get({ param: { code } }));
}

export async function acceptInvite(
  code: string,
  input: { name: string; email: string; password: string },
) {
  return readJson(await api.invites[":code"].accept.$post({ param: { code }, json: input }));
}

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

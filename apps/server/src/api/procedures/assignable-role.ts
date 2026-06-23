/**
 * Shared role-assignability guard used by both `users.ts` and `invites.ts`.
 * Lives under `api/procedures/` (not `auth/`) because `roleHasAdminTierPermission`
 * is only exported from the auth barrel — not from `auth/repo` — so callers must stay on the API side.
 */
import { roleHasAdminTierPermission, SYSTEM_ADMIN_ROLE_SLUG } from "../../auth";
import { getDb } from "../../db/client";
import { roles } from "../../db/schema/auth/roles";
import { eq } from "drizzle-orm";
import { badRequest, forbidden } from "../../diagnostics/http-errors";

/**
 * Resolves `roleId` from the database and throws a 400 when the role does not
 * exist. Returns the id + systemSlug pair needed by `requireAssignableRole`.
 */
export async function requireRole(
  roleId: string,
): Promise<{ id: string; systemSlug: string | null }> {
  const db = getDb();
  const roleExists = await db
    .select({ id: roles.id, systemSlug: roles.systemSlug })
    .from(roles)
    .where(eq(roles.id, roleId))
    .get();
  if (!roleExists) {
    throw badRequest("users.role_not_found", `role ${roleId} does not exist`, { roleId });
  }
  return roleExists;
}

/**
 * Rejects `roleId` if it is admin-equivalent: matches `SYSTEM_ADMIN_ROLE_SLUG`
 * OR holds any `admin:*` permission. Guards on capability, not slug, so a custom
 * role that grants admin power cannot be assigned (#576).
 */
export async function requireAssignableRole(roleId: string): Promise<void> {
  const role = await requireRole(roleId);
  // Slug check keeps its own code path so the original "system role" error
  // code stays intact for existing tests.
  if (role.systemSlug === SYSTEM_ADMIN_ROLE_SLUG) {
    throw forbidden("users.system_role", "Admin role cannot be assigned via this endpoint");
  }
  if (await roleHasAdminTierPermission(role.id, role.systemSlug)) {
    throw forbidden(
      "users.admin_role",
      "Roles granting admin-tier permissions cannot be assigned via this endpoint",
    );
  }
}

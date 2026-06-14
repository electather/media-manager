import { PERMISSIONS, type Permission } from "@nama/shared/auth";

export { PERMISSIONS, type Permission, ALL_PERMISSIONS } from "@nama/shared/auth";

/**
 * Privilege-granting permissions. A role holding any of these can manage users
 * or roles, so it is admin-equivalent regardless of its slug — assigning it
 * confers admin power. Narrower than `ADMIN_PERMISSIONS` (which also covers
 * server/jobs/plugins/requests): only `admin:users` and `admin:roles` let a
 * holder escalate other accounts, which is what the role-assignment guard
 * must block.
 */
export const ADMIN_TIER_PERMISSIONS = [
  PERMISSIONS.ADMIN_USERS,
  PERMISSIONS.ADMIN_ROLES,
] as const satisfies Permission[];

/**
 * Stable slug stored in `roles.system_slug` for the built-in Admin role.
 * Identifies the unconditional-all-permissions role independently of its
 * display name.
 *
 * Server-only by design: no client surface references the admin slug today.
 * If a shared schema validator or `@nama/shared/auth` enum ever needs it,
 * move this constant to `packages/shared/` rather than re-exporting it.
 */
export const SYSTEM_ADMIN_ROLE_SLUG = "admin" as const;

export interface UserRoleInfo {
  roleId: string;
  isSystemAdmin: boolean;
}

export { PERMISSIONS, type Permission, ALL_PERMISSIONS } from "@nama/shared/auth";

/**
 * Slug stored in `roles.system_slug` for the built-in Admin role — identifies the
 * unconditional-all-permissions role independently of its display name.
 * Server-only; if `@nama/shared/auth` ever needs it, move to `packages/shared/`.
 */
export const SYSTEM_ADMIN_ROLE_SLUG = "admin" as const;

export interface UserRoleInfo {
  roleId: string;
  isSystemAdmin: boolean;
}

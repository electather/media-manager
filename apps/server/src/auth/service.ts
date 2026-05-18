import type { Context, Next } from "hono";
import { auth } from "./internal/config";
import type { Auth } from "./internal/config";
import { authRouteHandler } from "./internal/oauth-handler";
import {
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
} from "./internal/oauth-metadata";
import type { Permission, UserRoleInfo } from "./types";
import {
  checkRolePermission,
  filterUsersWithPermission,
  findUserRole,
  listUsersWithPermission,
  type UserRoleRow,
} from "./repo";
import { currentRequestContext } from "../diagnostics/request-context";
import { forbidden, unauthorized } from "../diagnostics/http-errors";

export { auth, type Auth };
export { authRouteHandler };
export { oauthAuthorizationServerHandler, oauthProtectedResourceHandler };

// The seed creates exactly one system-admin role with this name. Changing the
// seed name without updating this constant silently breaks the admin bypass.
const SYSTEM_ADMIN_ROLE_NAME = "Admin" as const;

function rowToRoleInfo(row: UserRoleRow): UserRoleInfo {
  return {
    roleId: row.roleId,
    isSystemAdmin: row.isSystem === 1 && row.name === SYSTEM_ADMIN_ROLE_NAME,
  };
}

/**
 * Public sync surface for `auth/`. Other modules call methods on the
 * singleton via `getAuthService()`; the underlying DB queries stay behind
 * the repo boundary so callers cannot import drizzle-orm directly.
 */
export class AuthService {
  // ─── Role / permission queries ───────────────────────────────────────────

  /** Loads the user's role row. Returns `null` when no role is assigned. */
  async loadUserRole(userId: string): Promise<UserRoleInfo | null> {
    const row = await findUserRole(userId);
    return row ? rowToRoleInfo(row) : null;
  }

  /**
   * Returns `true` when `role` grants `permission`. The system Admin role
   * bypasses every check — same shortcut `requirePermission` enforces.
   */
  async roleHasPermission(role: UserRoleInfo, permission: Permission): Promise<boolean> {
    if (role.isSystemAdmin) return true;
    return checkRolePermission(role.roleId, permission);
  }

  /** Convenience: load role + check permission in one call. */
  async userHasPermission(userId: string, permission: Permission): Promise<boolean> {
    const role = await this.loadUserRole(userId);
    if (!role) return false;
    return this.roleHasPermission(role, permission);
  }

  // ─── Session helpers ─────────────────────────────────────────────────────

  /** Returns the authenticated user's id from the Hono context. */
  sessionUserId(c: Context): string {
    const session = c.get("session") as { user: { id: string } } | undefined;
    if (!session) throw unauthorized();
    return session.user.id;
  }

  /** Hono middleware that validates the Better Auth session. */
  async requireSession(c: Context, next: Next): Promise<void> {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      throw unauthorized();
    }
    c.set("session", session);
    // Attach the user id to the ambient request context so captureError can
    // correlate errors back to the authenticated user without every caller
    // passing it explicitly.
    const ctx = currentRequestContext();
    if (ctx) ctx.userId = session.user.id;
    await next();
  }

  /**
   * Returns a Hono middleware that checks the authenticated user has the
   * required permission. Must be used after `requireSession` so that
   * `c.get("session")` is populated.
   *
   * The system Admin role bypasses all permission checks — enforced here in
   * code, not by rows in role_permissions.
   */
  requirePermission(permission: Permission): (c: Context, next: Next) => Promise<void> {
    return async (c: Context, next: Next): Promise<void> => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) {
        throw unauthorized();
      }
      const role = await this.loadUserRole(session.user.id);
      if (!role) {
        throw forbidden();
      }
      if (!(await this.roleHasPermission(role, permission))) {
        throw forbidden();
      }
      await next();
    };
  }

  // ─── Recipient resolution ─────────────────────────────────────────────────

  /**
   * Returns user ids that hold `permission` via any role assignment.
   * De-duplicated. Used by `notifications` to resolve recipients for
   * admin-audience events.
   */
  listUsersHavingPermission(permission: Permission): Promise<string[]> {
    return listUsersWithPermission(permission);
  }

  /**
   * Subset of `userIds` whose roles grant `permission`. Used by
   * `notifications` for defense-in-depth re-check at dispatch time so a
   * permission revoked between emit and delivery does not leak through.
   */
  usersHavingPermission(userIds: string[], permission: Permission): Promise<Set<string>> {
    return filterUsersWithPermission(userIds, permission);
  }
}

let instance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!instance) instance = new AuthService();
  return instance;
}

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetAuthServiceForTest(): void {
  instance = null;
}

// ─── Backward-compat standalone exports ──────────────────────────────────────
//
// These are the named exports callers have always used (`import { requireSession }
// from "../../auth"`). Delegating to the singleton keeps the call sites unchanged
// while still routing through the service boundary.

/** @see {@link AuthService.loadUserRole} */
export function loadUserRole(userId: string): Promise<UserRoleInfo | null> {
  return getAuthService().loadUserRole(userId);
}

/** @see {@link AuthService.roleHasPermission} */
export function roleHasPermission(role: UserRoleInfo, permission: Permission): Promise<boolean> {
  return getAuthService().roleHasPermission(role, permission);
}

/** @see {@link AuthService.userHasPermission} */
export function userHasPermission(userId: string, permission: Permission): Promise<boolean> {
  return getAuthService().userHasPermission(userId, permission);
}

/** @see {@link AuthService.sessionUserId} */
export function sessionUserId(c: Context): string {
  return getAuthService().sessionUserId(c);
}

/** @see {@link AuthService.requireSession} */
export function requireSession(c: Context, next: Next): Promise<void> {
  return getAuthService().requireSession(c, next);
}

/** @see {@link AuthService.requirePermission} */
export function requirePermission(
  permission: Permission,
): (c: Context, next: Next) => Promise<void> {
  return getAuthService().requirePermission(permission);
}

/** @see {@link AuthService.listUsersHavingPermission} */
export function listUsersHavingPermission(permission: Permission): Promise<string[]> {
  return getAuthService().listUsersHavingPermission(permission);
}

/** @see {@link AuthService.usersHavingPermission} */
export function usersHavingPermission(
  userIds: string[],
  permission: Permission,
): Promise<Set<string>> {
  return getAuthService().usersHavingPermission(userIds, permission);
}

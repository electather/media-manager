import type { Context, Next } from "hono";
import { ADMIN_PERMISSIONS } from "@nama/shared/auth";
import { auth } from "./internal/config";
import type { Auth } from "./internal/config";
import { authRouteHandler } from "./internal/oauth-handler";
import {
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
} from "./internal/oauth-metadata";
import { SYSTEM_ADMIN_ROLE_SLUG, type Permission, type UserRoleInfo } from "./types";
import {
  checkRolePermission,
  deleteStaleDynamicClients,
  filterUsersWithPermission,
  findUserRole,
  listUsersWithPermission,
  roleHasAnyPermission,
  type UserRoleRow,
} from "./repo";
import { currentRequestContext } from "../diagnostics/request-context";
import { forbidden, unauthorized } from "../diagnostics/http-errors";
import { createUser, createUserWithRole } from "./internal/create-user";
import { claimBootstrap, ensureBootstrapToken, needsBootstrap } from "./internal/bootstrap";
import { findUserOnboarded, setUserOnboarded } from "./repo";

export { auth, type Auth };
export { authRouteHandler };
export { oauthAuthorizationServerHandler, oauthProtectedResourceHandler };

// ─── First-install / onboarding surface ──────────────────────────────────────
//
// Re-exported through the service boundary; callers reach these via the auth
// barrel. The user-table write for onboarding stays inside this module.
export { createUser, createUserWithRole };
export { claimBootstrap, ensureBootstrapToken, needsBootstrap };

/** Marks `userId` as having completed onboarding. */
export function markUserOnboarded(userId: string): Promise<void> {
  return setUserOnboarded(userId);
}

/** Reads whether `userId` has completed onboarding. */
export function isUserOnboarded(userId: string): Promise<boolean> {
  return findUserOnboarded(userId);
}

function rowToRoleInfo(row: UserRoleRow): UserRoleInfo {
  return {
    roleId: row.roleId,
    isSystemAdmin: row.systemSlug === SYSTEM_ADMIN_ROLE_SLUG,
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

  /**
   * Guards user-management endpoints against assigning admin-capable roles: a caller who sets a
   * `true` when `roleId` is the system Admin role or holds any `admin:*` permission.
   * Guards user-management endpoints against assigning admin-capable roles: a caller who sets a
   * Guards user-management endpoints against assigning admin-capable roles (`admin:*` or system Admin): a caller who sets a
   * passed separately because the system Admin role has no rows in `role_permissions`.
   */
  async roleHasAdminTierPermission(roleId: string, systemSlug: string | null): Promise<boolean> {
    if (systemSlug === SYSTEM_ADMIN_ROLE_SLUG) return true;
    return roleHasAnyPermission(roleId, ADMIN_PERMISSIONS);
  }

  // ─── Session helpers ─────────────────────────────────────────────────────

  /** Returns the authenticated user's id from the Hono context. */
  sessionUserId(c: Context): string {
    const session = c.get("session") as { user?: { id?: string } } | undefined;
    if (!session?.user?.id) throw unauthorized();
    return session.user.id;
  }

  /** Hono middleware that validates the Better Auth session. */
  async requireSession(c: Context, next: Next): Promise<void> {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    // Guard against malformed sessions (e.g. stale cookies, race conditions in
    // Better Auth) where the session object exists but `user` or `user.id` is
    // missing. Without this we would crash with a TypeError 500 below.
    if (!session?.user?.id) {
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
   * Hono middleware that checks the authenticated user has `permission`.
   * Must follow `requireSession` so `c.get("session")` is populated.
   * System Admin bypass is enforced in code, not by rows in `role_permissions`.
   */
  requirePermission(permission: Permission): (c: Context, next: Next) => Promise<void> {
    return async (c: Context, next: Next): Promise<void> => {
      const userId = this.sessionUserId(c);
      const role = await this.loadUserRole(userId);
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

  // ─── OAuth dynamic-client hygiene ────────────────────────────────────────

  /**
   * Deletes dynamically-registered OAuth clients that were never authorized and created before
   * `cutoff` (epoch ms). Bounds growth from the unauthenticated RFC 7591 registration endpoint.
   * Returns the number of clients removed.
   */
  sweepStaleDynamicClients(cutoff: number): Promise<number> {
    return deleteStaleDynamicClients(cutoff);
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

/** @see {@link AuthService.roleHasAdminTierPermission} */
export function roleHasAdminTierPermission(
  roleId: string,
  systemSlug: string | null,
): Promise<boolean> {
  return getAuthService().roleHasAdminTierPermission(roleId, systemSlug);
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

/** @see {@link AuthService.sweepStaleDynamicClients} */
export function sweepStaleDynamicClients(cutoff: number): Promise<number> {
  return getAuthService().sweepStaleDynamicClients(cutoff);
}

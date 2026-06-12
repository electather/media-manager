/**
 * Public barrel for `auth/`. Boundaries test asserts re-exports come only
 * from `./service`, `./events`, `./errors`, `./types`, and `./jobs`.
 * `./repo/**` and `./internal/**` are deliberately not re-exported —
 * external callers go through the service.
 */
export {
  auth,
  type Auth,
  AuthService,
  getAuthService,
  resetAuthServiceForTest,
  authRouteHandler,
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
  loadUserRole,
  roleHasPermission,
  userHasPermission,
  sessionUserId,
  requireSession,
  requirePermission,
  listUsersHavingPermission,
  usersHavingPermission,
} from "./service";
export { AUTH_EVENTS } from "./events";
export { AuthError } from "./errors";
export {
  PERMISSIONS,
  type Permission,
  ALL_PERMISSIONS,
  SYSTEM_ADMIN_ROLE_SLUG,
  type UserRoleInfo,
} from "./types";
export { registerJobs } from "./jobs";

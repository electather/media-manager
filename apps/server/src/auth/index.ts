/**
 * Public barrel for `auth/`. Only re-exports from `./service`, `./events`,
 * `./errors`, `./types`, and `./jobs` — `./repo/**` and `./internal/**` are
 * intentionally excluded; external callers go through the service.
 */
// A long re-export list inherently matches the sibling module barrels; this is
// the documented barrel shape, not extractable duplication.
// fallow-ignore-next-line code-duplication
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
  roleHasAdminTierPermission,
  sessionUserId,
  requireSession,
  requirePermission,
  listUsersHavingPermission,
  usersHavingPermission,
  createUser,
  createUserWithRole,
  needsBootstrap,
  ensureBootstrapToken,
  claimBootstrap,
  markUserOnboarded,
  isUserOnboarded,
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

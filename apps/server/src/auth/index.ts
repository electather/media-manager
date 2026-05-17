export { auth, type Auth } from "./config";
export {
  loadUserRole,
  roleHasPermission,
  userHasPermission,
  sessionUserId,
  requireSession,
  requirePermission,
} from "./middleware";
export { PERMISSIONS, type Permission, ALL_PERMISSIONS } from "./permissions";
export { authRouteHandler } from "./oauth-handler";
export { oauthAuthorizationServerHandler, oauthProtectedResourceHandler } from "./oauth-metadata";
export { listUsersHavingPermission, usersHavingPermission } from "./recipients";

/**
 * No-op for now. Auth emits no events and registers no scheduled jobs in
 * Phase 2; Phase 3 retrofit will introduce `jobs/index.ts` and replace this
 * stub. Boot tests exercise the call site to keep the alphabetical wiring
 * stable across modules.
 */
export function registerJobs(): void {
  /* no-op until Phase 3 */
}

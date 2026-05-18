/**
 * Cross-module events emitted by `auth/`. Empty in Phase 3b — auth is a
 * provider only (session + permission state is read by other modules via
 * the service). Future events such as `auth.session.created` will be
 * declared here once a downstream module needs to react to them.
 */
export const AUTH_EVENTS = {} as const;

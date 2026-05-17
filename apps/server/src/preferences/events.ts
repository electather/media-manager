/**
 * Cross-module events emitted by `preferences/`. Empty in Phase 3a — the
 * module is a consumer only (rebuilds + scoring are triggered by catalog
 * jobs and by user feedback flowing in via the service). Future events such
 * as `preferences.profile.rebuilt` will be declared here once a downstream
 * module needs to react to them.
 */
export const PREFERENCES_EVENTS = {} as const;

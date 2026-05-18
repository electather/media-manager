/**
 * Cross-module events emitted by `home/`. Empty in Phase 3e — home composes
 * synchronously through the orchestrator service and persists only its own
 * `home_layout_cache` table; no downstream module reacts to home state
 * changes today. Future events would be declared here once a consumer needs
 * them.
 */
export const HOME_EVENTS = {} as const;

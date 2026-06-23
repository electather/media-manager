/**
 * Cross-module events from `home/`. Empty in Phase 3e: home composes synchronously
 * and persists only `home_layout_cache`; no downstream module reacts to home state changes.
 */
export const HOME_EVENTS = {} as const;

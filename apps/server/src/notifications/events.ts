/**
 * Cross-module events emitted by `notifications/`. Empty in Phase 2 — the
 * module is a consumer only. Future delivery-result events (e.g.
 * `notifications.delivery.failed`) will be declared here once a downstream
 * module needs to react to them.
 */
export const NOTIFICATIONS_EVENTS = {} as const;

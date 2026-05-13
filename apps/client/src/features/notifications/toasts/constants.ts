export const USER_ACTIONABLE_EVENT_TYPES = [
  "media.request.available",
  "media.request.denied",
] as const;

export const MAX_TOASTS_PER_CYCLE = 3;
export const BROADCAST_CHANNEL_NAME = "notifications.toast";
export const BROADCAST_WINDOW_MS = 5 * 60_000;

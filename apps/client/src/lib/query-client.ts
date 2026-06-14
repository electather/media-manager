// 60s is the app-wide baseline staleTime; it matches the largest existing
// cluster of explicit overrides. Individual queries override it only when they
// need fresher (e.g. polling diagnostics/notifications) or longer (e.g. 5-min
// trending, immortal public config) caching.
export const DEFAULT_STALE_TIME_MS = 60_000;

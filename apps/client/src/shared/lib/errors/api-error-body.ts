/**
 * Shape of JSON error bodies returned by `/api/*` routes, as read by
 * feature-level typed error classes. Loose by design — the server middleware
 * ships `{ code, devMessage, params, requestId }`, but legacy paths and
 * plugin errors may carry other fields. Consumers read `code` and a
 * human-facing `message` when present; the index signature lets fallbacks
 * inspect anything else without widening to `unknown`.
 */
export interface ApiErrorBody {
  code?: string;
  message?: string;
  /** Server-shipped English diagnostic string (`HttpError`-style). */
  devMessage?: string;
  /** Code-specific param map shipped by `HttpError` middleware. */
  params?: Record<string, string | number>;
  /** Mirrored request id from the response body, when shipped. */
  requestId?: string;
  [k: string]: unknown;
}

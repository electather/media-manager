/** Shape of `/api/*` error bodies (loose by design). Server ships `{ code, devMessage, params, requestId }`,
 *  but legacy/plugin errors may carry other fields. Index signature lets inspection without widening to unknown. */
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

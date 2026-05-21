/** Thrown by handlers and services to return a structured user-facing error.
 *  4xx bodies below 500 are treated as expected user-input failures and do NOT
 *  enter the error store; 5xx (and any unrecognized throw) is captured.
 *
 *  `params` carries flat translation values (`{ field: "name" }`); `details`
 *  carries code-specific structured payloads (`{ errors: [...] }` for
 *  `media.providers_failed`, `{ candidates: [...] }` for
 *  `mcp.ambiguous_target`) — matches `UserFacingError.details` from
 *  `@ent-mcp/shared/diagnostics`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params?: Record<string, string | number>;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    params?: Record<string, string | number>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.params = params;
    this.details = details;
  }
}

export function isExpectedUserError(status: number): boolean {
  return status >= 400 && status < 500;
}

/** Factory helpers so call sites read as intent, not as HTTP status arithmetic. */
export const badRequest = (
  code: string,
  message: string,
  params?: Record<string, string | number>,
): HttpError => new HttpError(400, code, message, params);

export const unauthorized = (
  code: string = "http.unauthorized",
  message: string = "unauthorized",
): HttpError => new HttpError(401, code, message);

export const forbidden = (
  code: string = "http.forbidden",
  message: string = "forbidden",
): HttpError => new HttpError(403, code, message);

export const notFound = (
  code: string,
  message: string,
  params?: Record<string, string | number>,
): HttpError => new HttpError(404, code, message, params);

export const conflict = (
  code: string,
  message: string,
  params?: Record<string, string | number>,
): HttpError => new HttpError(409, code, message, params);

export const payloadTooLarge = (
  code: string,
  message: string,
  params?: Record<string, string | number>,
): HttpError => new HttpError(413, code, message, params);

export const unprocessable = (
  code: string,
  message: string,
  params?: Record<string, string | number>,
): HttpError => new HttpError(422, code, message, params);

export const internal = (
  code: string = "http.internal_error",
  message: string = "internal error",
): HttpError => new HttpError(500, code, message);

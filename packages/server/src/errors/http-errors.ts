/** Thrown by handlers to return a structured user-facing error. 4xx bodies below 500
 *  are treated as expected user-input failures and do NOT enter the error store. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params?: Record<string, string | number>;

  constructor(
    status: number,
    code: string,
    message: string,
    params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export function isExpectedUserError(status: number): boolean {
  return status >= 400 && status < 500;
}

import type { ApiErrorBody } from "./api-error-body";

/**
 * Base class for typed fetch errors. Subclasses pass `name` + `fallback` message;
 * inherit `status`/`body`/`code` so features throw their own error type without re-implementing wire parsing.
 */
export class BaseApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  constructor(name: string, status: number, body: ApiErrorBody | null, fallback: string) {
    super(deriveMessage(body, fallback));
    this.name = name;
    this.status = status;
    this.body = body;
    this.code = readCode(body);
  }
}

/** Returns a user-facing string from any thrown value; centralises the `instanceof XxxApiError ? .message : String()` idiom. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function deriveMessage(body: ApiErrorBody | null, fallback: string): string {
  return body?.message ?? fallback;
}

function readCode(body: ApiErrorBody | null): string | undefined {
  const code = body?.code;
  return typeof code === "string" ? code : undefined;
}

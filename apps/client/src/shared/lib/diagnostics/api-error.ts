import type { ApiErrorBody } from "./api-error-body";

/**
 * Base class for typed fetch errors. Subclasses pass a `name` + `fallback`
 * message and inherit `status` / `body` / `code` so each feature can throw
 * its own surface-specific error type without re-implementing the wire
 * shape parsing.
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

/**
 * Resolves a user-facing message from an unknown thrown value. Every feature's
 * mutation `onError` handler narrowed on its own `XxxApiError` subclass before
 * reaching for `.message`, but each of those subclasses extends `Error`, so the
 * narrowing is equivalent to a plain `instanceof Error` check. Centralising it
 * here removes that repeated idiom from each feature's hooks.
 */
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

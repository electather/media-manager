import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";

/**
 * Typed error thrown by command-menu fetchers on non-2xx responses. Lets the
 * inline retry row read `status` / `code` without re-parsing the wire body.
 */
export class CommandMenuApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `command-menu request failed (${status})`);
    this.name = "CommandMenuApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

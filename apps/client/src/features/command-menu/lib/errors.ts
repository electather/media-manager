import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/**
 * Typed error thrown by command-menu fetchers on non-2xx responses. Lets the
 * inline retry row read `status` / `code` without re-parsing the wire body.
 */
export class CommandMenuApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("CommandMenuApiError", status, body, `command-menu request failed (${status})`);
  }
}

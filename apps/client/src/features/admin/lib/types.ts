import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/**
 * Typed fetch error for the admin feature. Carries `status`, `body`, and
 * `code` so error boundaries can narrow on typed fields.
 */
export class AdminApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AdminApiError", status, body, `admin request failed (${status})`);
  }
}

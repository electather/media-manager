import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

export class SettingsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("SettingsApiError", status, body, `settings request failed (${status})`);
  }
}

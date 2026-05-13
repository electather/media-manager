import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

export class SettingsConnectionsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super(
      "SettingsConnectionsApiError",
      status,
      body,
      `settings connections request failed (${status})`,
    );
  }
}

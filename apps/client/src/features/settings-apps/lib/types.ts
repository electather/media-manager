import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

export type AuthorizedAppsFilter = "all" | "active" | "idle" | "new";

export class SettingsAppsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("SettingsAppsApiError", status, body, `settings apps request failed (${status})`);
  }
}

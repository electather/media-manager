import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/**
 * Typed error for onboarding and bootstrap requests. Carries the HTTP status and
 * the parsed `{ code, message }` envelope so callers can branch on
 * `err.code` (for example `bootstrap.invalid_token` vs
 * `bootstrap.already_completed`).
 */
export class OnboardingApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("OnboardingApiError", status, body, `onboarding request failed (${status})`);
  }
}

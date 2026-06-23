import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

// Typed error carrying status and parsed {code, message} for caller branching on err.code.
export class OnboardingApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("OnboardingApiError", status, body, `onboarding request failed (${status})`);
  }
}

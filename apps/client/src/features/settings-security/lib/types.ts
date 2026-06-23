import { z } from "zod";

import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/** Better Auth session shape narrowed to security-tab fields. Kept local to decouple from
 *  upstream churn. Dates coerced at trust boundary (rejects bad ISO/Date, not `new Date(...)`).
 */
export const authSessionSchema = z.object({
  id: z.string(),
  token: z.string(),
  userId: z.string(),
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});

export type AuthSession = z.infer<typeof authSessionSchema>;

export interface DisplaySession extends AuthSession {
  current: boolean;
}

/**
 * Typed error for the security surface. Carries `status` / `body` / `code`
 * so the settings error boundary can render a surface-specific fallback,
 * including parse failures at the Better Auth trust boundary.
 */
export class SettingsSecurityApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("SettingsSecurityApiError", status, body, `settings-security request failed (${status})`);
  }
}

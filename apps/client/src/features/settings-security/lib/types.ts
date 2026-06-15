import { z } from "zod";

import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/**
 * Better Auth session shape, narrowed to the fields the security tab reads.
 * The full type lives in `better-auth/types`; we keep this local one to
 * decouple the UI from upstream churn.
 *
 * Better Auth serializes the date fields as `Date` on direct calls and as
 * ISO strings over the wire. `z.coerce.date()` accepts both and rejects
 * non-parseable strings, so a bad value throws at the trust boundary rather
 * than reaching `new Date(...)` and rendering "NaN years ago".
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

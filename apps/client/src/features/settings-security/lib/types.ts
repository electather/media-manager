import { z } from "zod";

import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/**
 * Better Auth session shape, narrowed to the fields the security tab reads.
 * The full type lives in `better-auth/types`; we keep this local one to
 * decouple the UI from upstream churn.
 *
 * Better Auth serializes the date fields as `Date` on direct calls and as
 * ISO strings over the wire, so both are accepted at the trust boundary.
 */
export const authSessionSchema = z.object({
  id: z.string(),
  token: z.string(),
  userId: z.string(),
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()]),
  expiresAt: z.union([z.date(), z.string()]),
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

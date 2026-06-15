import { z } from "zod";

import { authClient } from "@/shared/lib/auth";
import { authSessionSchema, SettingsSecurityApiError, type AuthSession } from "./types";

const sessionListSchema = z.array(authSessionSchema);

// CRAP is inflated by defensive trust-boundary fallbacks, which are intentional.
// fallow-ignore-next-line complexity
export async function fetchSessions(): Promise<AuthSession[]> {
  const result = await authClient.listSessions();
  if (result.error) {
    throw new SettingsSecurityApiError(result.error.status ?? 0, {
      message: result.error.message ?? "Failed to load sessions",
    });
  }
  // Validate at the trust boundary so a renamed or omitted upstream field
  // surfaces as a typed error the error boundary can render, rather than
  // silently rendering `Invalid Date` or revoking with an `undefined` token.
  const parsed = sessionListSchema.safeParse(result.data ?? []);
  if (!parsed.success) {
    throw new SettingsSecurityApiError(0, {
      message: "Received an unexpected session list shape",
    });
  }
  return parsed.data;
}

export async function fetchRevokeSession(token: string): Promise<void> {
  const result = await authClient.revokeSession({ token });
  if (result.error) throw new Error(result.error.message ?? "Revoke failed");
}

export async function fetchRevokeOtherSessions(): Promise<void> {
  const result = await authClient.revokeOtherSessions();
  if (result.error) throw new Error(result.error.message ?? "Revoke failed");
}

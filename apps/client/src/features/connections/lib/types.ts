// Re-export authoritative `PluginSummary` from shared (owned by server contract) instead of client copy. Modal reads subset, extra fields harmless.
import type { PluginSummary } from "@nama/shared/connections";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

export type { PluginSummary };

// Typed error thrown by the connections fetchers on a non-OK response, per
// the frontend-feature-architecture hard rule 3. Carries `status` / `body` /
// `code` so callers can branch on the wire envelope instead of string
// matching on `err.message`.
export class ConnectionsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("ConnectionsApiError", status, body, `connections request failed (${status})`);
  }
}

export interface ExistingConnection {
  id: string;
  displayName: string | null;
}

export type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok" } | { kind: "err" };

export type DeviceState =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "waiting";
      userCode: string;
      verifyUrl: string;
      nonce: string;
      intervalSec: number;
      expiresAt: number;
    }
  | { kind: "err"; message: string };

export type Stage = "configure" | "done";

export type AuthKind = PluginSummary["authKind"];

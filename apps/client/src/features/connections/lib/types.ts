// The wire shape the connection modal renders is owned by the server contract,
// so re-export the authoritative `PluginSummary` from the shared package rather
// than maintaining a parallel client copy that can drift. The modal reads a
// subset of its fields; the extra fields (poolable, credentialsSchema) are
// harmless to carry through. Imported (not just re-exported) so the local
// `AuthKind` alias below can index into it.
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

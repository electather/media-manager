// The wire shape the connection modal renders is owned by the server contract,
// so re-export the authoritative `PluginSummary` from the shared package rather
// than maintaining a parallel client copy that can drift. The modal reads a
// subset of its fields; the extra fields (poolable, credentialsSchema) are
// harmless to carry through. Imported (not just re-exported) so the local
// `AuthKind` alias below can index into it.
import type { PluginSummary } from "@nama/shared/connections";

export type { PluginSummary };

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

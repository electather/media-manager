import type { CapabilityEntry } from "@/shared/lib/capabilities";

/**
 * Shape the connection modal needs to render the create/edit dialog. Mirrors
 * the `PluginSummary` shape returned by `/api/connections/available` and
 * embedded on connection rows — both `connections.tsx` and
 * `admin/plugins.tsx` can pass the inferred row through unchanged.
 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  authKind: "form" | "oauth_redirect" | "oauth_device" | "none";
  userScopedCapabilities: ReadonlyArray<CapabilityEntry>;
  globalScopedCapabilities: ReadonlyArray<CapabilityEntry>;
  userConfigSchema: Record<string, unknown> | null;
  adminSharedAvailable: boolean;
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

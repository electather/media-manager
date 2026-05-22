import type { ConnectionStatus } from "./enums";
import type { AuthKind } from "../plugins/enums";
import type { MediaType } from "../media/enums";

/**
 * Embedded plugin shape on every `ConnectionListItem` and the entries returned
 * by `GET /api/connections/available`. Authoritative for the user-facing UI:
 * available cards, connected cards, and the connection modal all render off of
 * this. Admin-only fields live on the `PluginRow` shape used by `/api/plugins/`.
 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  authKind: AuthKind;
  poolable: boolean;
  /** Capabilities the user must connect to unlock. `scope` is implicit. */
  userScopedCapabilities: Array<{ id: string; version: string }>;
  /** Capabilities that work without any user action. `scope` is implicit. */
  globalScopedCapabilities: Array<{ id: string; version: string }>;
  /** JSON Schema or `null` when the manifest declares none. */
  userConfigSchema: Record<string, unknown> | null;
  /** JSON Schema or `null` when the manifest declares none. */
  credentialsSchema: Record<string, unknown> | null;
  /** True when the admin pool has at least one enabled entry for this plugin. */
  adminSharedAvailable: boolean;
}

/** Server-rendered display field for a connection's non-secret user config. */
export interface ConnectionDisplayField {
  label: string;
  value: string;
  mono?: boolean;
}

/** Row returned by `GET /api/connections`. Plugin metadata is joined in. */
export interface ConnectionListItem {
  id: string;
  pluginId: string;
  status: ConnectionStatus;
  enabled: boolean;
  isDefault: boolean;
  displayName: string | null;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Server-computed display fields derived from `userConfigSchema` and the
   * decrypted user config. Excludes `x-secret`, redacts `x-private` to
   * "••••". Empty when the plugin has no non-secret user config.
   */
  displayFields: ConnectionDisplayField[];
  plugin: PluginSummary;
}

/**
 * Row returned by `GET /api/connections/primary`. The DB stores `mediaType`
 * as a `"_"` sentinel for "no media-type partition"; the wire shape uses
 * `null` so the client doesn't have to know about the sentinel.
 */
export interface PrimaryConnectionRow {
  capabilityKey: string;
  mediaType: MediaType | null;
  connectionId: string;
}

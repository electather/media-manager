import type { JSONSchema, JsonValue } from "../common";
import type { NotificationContentKind } from "../notifications/enums";
import type { AuthKind, CapabilityScope } from "./enums";

/** One entry in `manifest.capabilities`. Scope governs credential routing. */
export interface ManifestCapability {
  version: string;
  scope: CapabilityScope;
  /** Optional, used by `notificationDelivery` to advertise renderable content kinds. */
  supportsKinds?: NotificationContentKind[];
}

export interface McpToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  readOnlyHint?: boolean;
}

/**
 * Declarative MCP tool record declared by a plugin manifest. The host prefixes
 * plugin-declared tools with `ext_<plugin_id>_` before registration.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  /** Name of the handler export on the plugin module's `mcpTools` object. */
  handler: string;
  annotations?: McpToolAnnotations;
}

export interface ManifestJobEntry {
  id: string;
  schedule: string;
  handler: string;
  perConnection?: boolean;
  /**
   * Override the default 60s per-row timeout for `perConnection` jobs. Use for
   * upstreams that legitimately need more time per page (e.g. slow Seerr
   * `/request` pagination). Ignored for non-per-connection jobs.
   */
  perRowTimeoutSec?: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  author: { name: string; url?: string };
  homepage?: string;
  sdkVersion: string;
  allowedHosts: string[];
  /** Plaintext admin config (e.g. display settings, base URLs). */
  globalConfigSchema?: JSONSchema;
  /** Encrypted admin secrets — one schema, many pool entries for `poolable` plugins. */
  sharedCredentialsSchema?: JSONSchema;
  /**
   * Built-in default shared credential baked into source. Synthesized as a
   * read-only, lowest-priority pool entry so the plugin works with zero admin
   * config (design 2026-06-29 §1). Requires `sharedCredentialsSchema` (the value
   * is validated against it at load). Public by design — same tradeoff as seerr.
   */
  defaultSharedCredentials?: JsonValue;
  /** Plaintext user config. Rendered on connection forms. */
  userConfigSchema?: JSONSchema;
  /**
   * Encrypted user secrets. Required when any capability has `scope: "user"`
   * (validated at manifest install).
   */
  credentialsSchema?: JSONSchema;
  auth: { kind: AuthKind };
  capabilities: Record<string, ManifestCapability>;
  /**
   * When true, the admin may configure multiple `shared_credentials` entries
   * and the host rotates across them on rate-limit.
   */
  poolable?: boolean;
  jobs?: ManifestJobEntry[];
  /** Optional plugin-contributed MCP tools. Capped at 5 per plugin. */
  mcpTools?: McpToolDefinition[];
}

// Plugin author API. Every symbol a third-party plugin imports comes through
// this barrel — either owned by the SDK or re-exported from `@ent-mcp/shared`.
// The SDK never re-exports from `@ent-mcp/server`; host-internal subsystems
// stay on the server.

// ─── Owned by the SDK ─────────────────────────────────────────────────────────
export * from "./types";
export * from "./define";
export * from "./errors/plugin-error";
export * from "./utils/http-status";
export * from "./utils/credentials";
export * from "./capabilities";
export * from "./validate";
export * from "./version";

// ─── Re-exported from @ent-mcp/shared so plugin authors only need one dep ─────
export {
  pluginManifestSchema,
  manifestCapabilitySchema,
  manifestJobEntrySchema,
  authKindSchema,
  capabilityScopeSchema,
} from "@ent-mcp/shared/plugins";
export type {
  PluginManifest,
  ManifestCapability,
  ManifestJobEntry,
  McpToolDefinition,
  McpToolAnnotations,
  AuthKind,
  CapabilityScope,
} from "@ent-mcp/shared/plugins";
export type { JSONSchema } from "@ent-mcp/shared/common";
export type { HostErrorCode } from "@ent-mcp/shared/errors";

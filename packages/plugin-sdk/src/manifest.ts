// Re-exports the manifest schema and type so plugin authors can pull them from
// `@ent-mcp/plugin-sdk` without ever importing from `@ent-mcp/shared` directly.
// Canonical home stays in `@ent-mcp/shared/plugins` — this module exists so the
// SDK source tree matches the layout described in
// `docs/2026-04-25-plugin-monorepo-design.md`.
export { pluginManifestSchema } from "@ent-mcp/shared/plugins";
export type { PluginManifest, ManifestCapability, ManifestJobEntry } from "@ent-mcp/shared/plugins";

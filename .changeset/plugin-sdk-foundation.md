---
"@ent-mcp/plugin-sdk": minor
"@ent-mcp/server": patch
"@ent-mcp/client": patch
---

Introduce `@ent-mcp/plugin-sdk` (initial release) and reorganise the workspace into `apps/{client,server}` + `packages/{shared,plugin-sdk}` per the plugin monorepo design. Plugin-author symbols (`PluginContext`, `PluginModule`, `definePlugin`, `validatePluginModule`, capability schemas, `PluginError`, `handleHttpStatus`, `resolveCredential`, testing kit) now live in the SDK; the server consumes them through the package boundary instead of relative imports. Pre-flight: relocate `HOST_ERROR_CODES` / `HostErrorCode` / `UserFacingError` / `severityFor` / `pluginCode` to `@ent-mcp/shared/errors` and flip `@ent-mcp/server` and `@ent-mcp/client` to `private: false` so Changesets tags them. No behavioural changes — packaging refactor only.

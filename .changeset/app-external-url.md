---
"@ent-mcp/server": minor
---

Add required `APP_EXTERNAL_URL` env var and expose it as `ctx.appBaseUrl` on `PluginContext` so plugins can build OAuth redirect URIs and outward-facing deep links (e.g. `playerLink`, `webLink`).

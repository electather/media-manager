---
"@ent-mcp/server": minor
"@ent-mcp/client": minor
"@ent-mcp/shared": minor
---

Add admin-only advanced policy for installed plugins: per-plugin host allowlist
override (intersection with `manifest.allowedHosts`) and encrypted custom headers
injected into every `ctx.fetch` call. Blocked-host attempts are logged under a
new `plugin.host_blocked_by_admin` error code. Plugins continue to see the
existing `plugin.upstream_error` so no plugin changes are required.

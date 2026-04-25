---
"@ent-mcp/client": minor
---

Phase 2 of the plugin-connections UI revamp (#44 #45 #46): switch
`/settings/connections` and `/admin/plugins` from hand-written response
interfaces to `InferResponseType` aliases against the existing Hono
client; add `renderCapabilityBadges` and `capabilityListSummary` helpers
to `lib/capabilities.tsx`; and consume `connection.displayFields`
directly on the connection card. The connection-modal header now renders
user-scoped capability badges with a muted "Also provides …" line for
the global-scoped ones (sr-only prefix for screen-reader grouping).
`nonSecretFields` and the modal's `auth` / `capabilities` flat shape
are gone — `PluginSummary` now mirrors the server's embedded plugin
shape so `connections.tsx` can pass inferred rows through unchanged.

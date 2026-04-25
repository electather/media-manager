---
"@ent-mcp/client": minor
---

Phase 2 of the plugin-connections UI revamp (#44 #45 #46): switch
`/settings/connections` and `/admin/plugins` from hand-written response
interfaces to `InferResponseType` aliases against the existing Hono
client; add a `<CapabilityBadges>` component and `capabilityListSummary`
helper to `lib/capabilities.tsx` (with explicit icon entries for every
currently-declared capability); and consume `connection.displayFields`
directly on the connection card. The connection-modal header now renders
user-scoped capability badges with a muted "Also provides …" line for
the global-scoped ones (sr-only prefix for screen-reader grouping). The
available card splits its scopes the same way (badges for user-scoped,
muted "available without a connection" footer for global-scoped) and
the "Add your own key" button matches the design doc copy. The modal
maps the typed `plugin.credentials_empty` error to the spec'd copy
("Credentials can't be blank. Enter a {field.title} to continue.") with
the schema title substituted client-side, while `plugin.invalid_base_url`
continues through generic field-routing. `nonSecretFields` is gone and
the modal's `PluginSummary` mirrors the server's embedded plugin shape.
`showDefault` now also surfaces "Set as default" for poolable plugins
even with a single connection, per the design doc.

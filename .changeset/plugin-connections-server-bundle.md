---
"@ent-mcp/server": minor
"@ent-mcp/shared": minor
---

Server bundle for the plugin-connections UI revamp (#39 #40 #41 #42 #43): widen the embedded plugin shape on `/api/connections/` to a full `PluginSummary` (renames `auth` → `authKind`, replaces flat `capabilities` with scoped arrays, drops `enabled`, adds `poolable` / `adminSharedAvailable` / `credentialsSchema`); compute `displayFields` server-side from `userConfigSchema` (excludes `x-secret`, redacts `x-private` to `••••`, marks URI / `x-mono` / `x-allowed-host` fields as `mono`); add `sharedCredentialsEnabledCount` and widen `sharedCredentialsCount` to total entries on `/api/plugins/`; rename `auth` → `authKind` on `/api/connections/available`; add `POST /api/plugins/:id/shared-credentials/test-ephemeral` for unsaved-credential probes; and add typed error codes `plugin.credentials_empty`, `plugin.duplicate_label`, `plugin.invalid_base_url` (the latter replacing `plugin.input_invalid` for `x-allowed-host` validation failures) so the frontend can route inline field errors.

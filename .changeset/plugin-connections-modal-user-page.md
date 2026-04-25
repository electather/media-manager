---
"@ent-mcp/client": minor
---

Phase 3 of the plugin-connections UI revamp (#47 #48): refactor the
`/settings/connections` page into the calmer settings-style layout
(text-base h2, text-sm h3 sub-sections, divide-y rounded-xl row lists)
and drop the bigger Card containers; render scoped capabilities through
`<CapabilityBadges>` everywhere so the connected group header, available
list, and modal share one badge code path. The connection modal already
mapped `plugin.credentials_empty` to the spec'd "Credentials can't be
blank. Enter a {field.title} to continue." copy in Phase 2; this PR
renames the inner `title` local to `fieldTitle` so it no longer shadows
the modal's outer `title`, and adds component tests covering all three
design-doc cases (`plugin.credentials_empty` rewrite, `plugin.invalid_base_url`
field-routing, and the scoped capability header rendering with the
"Also provides …" line for global-scoped capabilities).

---
"@ent-mcp/client": minor
---

Phase 3 of the plugin-connections UI revamp (#47 #48): refactor the
`/settings/connections` page into the calmer settings-style layout
(text-base h2, text-sm h3 sub-sections, divide-y rounded-xl row lists)
and drop the bigger Card containers; render scoped capabilities through
`<CapabilityBadges>` everywhere so the connected group header, available
list, and modal share one badge code path. The connection modal already
mapped `plugin.credentials_empty` to the spec'd typed copy in Phase 2;
this PR renames the inner `title` local to `fieldTitle` so it no longer
shadows the modal's outer `title`, switches the article to `a`/`an`
based on the field title's first letter (so "Enter an API Key …" reads
correctly), and wires the edit-mode prefill to fetch
`GET /api/connections/:id/user-config` so opening Edit hydrates non-secret
fields with the user's stored values. Adds component tests covering the
three design-doc cases (`plugin.credentials_empty` rewrite,
`plugin.invalid_base_url` field-routing, and the scoped capability
header). The connection card also now shows a `Disconnected` badge for
connections that report `status: "disconnected"`.

---
"@ent-mcp/client": minor
---

Phase 4 of the plugin-connections UI revamp (#49 #50 #51). Lifts the
shared-credentials table out of the tabbed `ConfigureDialog` onto the
admin plugin card so admins manage the pool inline; adds a
`<PersonalKeyFallbackControl>` segmented control with a live explainer
and optimistic+revert behaviour; and wires a new
`<SharedCredentialDialog>` whose primary `Test & save` button hits
`POST /api/plugins/:id/shared-credentials/test-ephemeral` first and
persists only on `{ ok: true }` (no save-then-test-then-delete dance).

The plugin card now renders scope rows (`Global:` / `User:`) through
`<CapabilityBadges>` with sr-only prefixes for screen-reader grouping,
a `Pool: enabled/total enabled` meta line driven by the Phase 1 counts,
and a meta-line auth/installed summary. The pool row carries a
`Ready` / `Retry mm:ss` / `Disabled` status pill backed by a new
`useNow(intervalMs, { active })` hook that only schedules the interval
when at least one row is in cooldown — idle admin pages no longer
re-render every second. The delete confirmation moved off `window.confirm()`
to a real `Dialog` for the deferred Phase 2 review note. The dropdown's
"Configure" item collapses to a single-purpose "Configure global config"
entry, and the credentials tab is gone from the dialog. Toasts cover
saves, deletes, and fallback-policy updates per the design doc's
toast/inline split.

Also drops the now-dead `userConfig` field from the connection modal's
`ExistingConnection` interface (deferred Phase 3 review note).

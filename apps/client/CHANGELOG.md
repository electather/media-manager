# @ent-mcp/client

## 0.2.0

### Minor Changes

- 8849c1b: Unified the admin and account settings pages under a shared sidebar layout.
- 249a4f1: Introduced a new app shell with a top profile menu and a bottom navigation bar across all screen sizes for the home, activity, requests, taste, and profile pages.
- 0a9807f: Reduced repeat artwork lookups on the home feed by serving inline artwork URLs whenever they are already known and only fetching from external services when a slot is missing.
- db2b076: Added a batched artwork lookup so the home feed loads high-resolution posters and backdrops once cards are visible, with a graceful fallback to inline thumbnails while the lookup is in flight.
- 8849c1b: Refreshed the bottom navigation as a floating glass pill with horizontal labels and added a Library tab.
- eb22017: Refreshed the dark theme to use the Figma-sampled palette and locked the sans typeface to Geist Variable across all surfaces.
- db2b076: Added a Netflix-style home feed with a continue-watching hero, an upcoming sidebar, and recommendation rows that scroll horizontally. Clicking any item opens a quick-look detail overlay without leaving the feed.
- 77ed7b0: Home feed layout now loads row structure instantly and fetches row items lazily per row.

### Patch Changes

- 5986e73: Cleaned up the admin Plugins page so plugins like Trakt no longer show an empty actions menu or a fallback policy control that didn't apply.
- ca50c56: Artwork now loads per card with above-the-fold prioritization, so a single slow image no longer delays the rest of the row.
- db2b076: Fixed the home feed layout when there is no hero so the upcoming-episodes column slides into the main feed instead of stacking as a full-width list, and made card sizes within a row consistent regardless of which items happen to have progress or episode metadata.
- e9b915f: Reorganise the workspace so plugin authors have a single dedicated SDK to depend on. No user-visible behaviour change.
- Updated dependencies [db2b076]
- Updated dependencies [986fb74]
  - @ent-mcp/shared@0.1.1

## 0.1.0

### Minor Changes

- bde0d39: Route backend-originated validation errors to the specific form input that caused them, instead of only the top-of-modal banner. Reuses the existing `params` slot on `UserFacingError` via a `params.field` convention — any `PluginError` can carry `{ field, value }` params that thread through `runAuth` → `AuthResult.error.params` → `unprocessable(..., { ..., field })` → wire-body `params.field`. The client's new `packages/client/src/lib/errors/form-errors.ts` helper (`splitFormError` + `parseFormErrorResponse`) is reusable from any form surface — given a body and the form's property names it returns `{ message, fieldErrors }` so the caller just assigns into existing state. `allowed-hosts.ts` is the first emitter: a bad URL or blocked hostname now highlights the `externalServerUrl` input directly.
- c336404: Add admin-only advanced policy for installed plugins: per-plugin host allowlist
  override (intersection with `manifest.allowedHosts`) and encrypted custom headers
  injected into every `ctx.fetch` call. Blocked-host attempts are logged under a
  new `plugin.host_blocked_by_admin` error code. Plugins continue to see the
  existing `plugin.upstream_error` so no plugin changes are required.
- 8d61639: Phase 4 of the plugin-connections UI revamp (#49 #50 #51). Lifts the
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

  The fallback control is now scoped to plugins where the policy can
  actually do something — i.e. plugins that declare a
  `sharedCredentialsSchema` (so an admin pool exists) on top of having
  either user-scoped capabilities or being pure-global. Plugins like
  Plex / Jellyfin / Seerr that declare no `sharedCredentialsSchema` at
  all (purely user-side) skip the row entirely; the only sensible policy
  there is `off` and rendering the segmented control would suggest an
  option the admin can't actually use. Design doc updated to match.

- ec0feb6: Phase 2 of the plugin-connections UI revamp (#44 #45 #46): switch
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
- 33c82f4: Phase 3 of the plugin-connections UI revamp (#47 #48): refactor the
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
- bde0d39: Add a new `x-plugin-resolved: true` JSON Schema extension for `userConfigSchema` properties that the plugin owns and the user must never submit. On incoming client payloads, `createFormConnection` and `updateUserConfig` strip these keys _before_ the payload reaches `startAuth` or the persisted row — the plugin repopulates them through `userConfigPatch`. A hostile client cannot impersonate another account by spoofing e.g. Jellyfin's `userId`. The frontend hides `x-plugin-resolved` fields from the create form entirely and renders them disabled on the edit form so users can see what the plugin resolved. Composes with standard JSON Schema `readOnly: true` (display-only hint) — `x-plugin-resolved` adds the server-side stripping on top.

  Applied to Jellyfin's `userId` userConfig field (version bumped to 1.0.1).

- 8a58047: Move /connections to /settings/connections. The top-level Connections sidebar entry is removed; /connections now 404s.
- b447051: Wire /settings/security with change-password, active-sessions list with revoke, and sign-out-everywhere.
- 64197cc: Wire the Profile, Authorized apps, and Danger zone tabs to real backends and add the supporting endpoints. The server gains `/me/apps` (list + revoke), `/me/export` (versioned ZIP), `/me/delete` (password + email gated, FK cascade), and email-aware Better Auth config that targets the old address for change-email confirmation. The client tabs replace their mocks with real queries/mutations, including a verification banner with 60s resend cooldown and a delete dialog that refuses to submit until both inputs validate.

### Patch Changes

- bde0d39: Fix the add/edit-connection modal going off-screen when a plugin's config form is taller than the viewport. `DialogContent` is now capped at `calc(100dvh - 2rem)` and its body is a vertically scrollable region, with the header and footer pinned. Scoped to the connection modal only — other dialogs are unchanged.
- bde0d39: Merge the add-connection modal's two separate error surfaces into one. Previously the "Test connection" button rendered its failure inline below the form while "Save" showed a generic `Failed to create connection.` in a different banner — both from the same underlying server error. Now both paths route through a single `topError` banner populated by the actual server message, and the client's error-body parser reads `params.message` / `devMessage` from the `UserFacingError` wire format so the user sees the real cause (e.g. the upstream plugin message) instead of a stock string.
- Updated dependencies [bde0d39]
- Updated dependencies [ec33991]
- Updated dependencies [c336404]
- Updated dependencies [df3624f]
- Updated dependencies [09f1101]
  - @ent-mcp/shared@0.1.0

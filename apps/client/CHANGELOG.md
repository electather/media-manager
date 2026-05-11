# @ent-mcp/client

## 0.5.0

### Minor Changes

- a51266f: Redesigned the admin plugins page as a list-plus-detail flow with dedicated Overview, Configuration, Security, and Shared credentials tabs.
- 50d01ed: Added admin Users and Roles & permissions pages, ported from the nama prototype. Users wires to the existing admin users API for role changes, session revocation, and deletion; pending invites and role definitions remain local until backend endpoints land.
- c7ea341: Ported the authorized apps settings page from the Nama prototype: the MCP endpoint card now shows a live-status meta line, scope summary, and rotate-URL action, while authorized clients gained activity pills, scope chips, status filters, bulk-revoke, and per-client view-activity / rename / revoke actions.
- ce2b0c5: Renamed the admin Errors page to Diagnostics and added a Performance tab that surfaces request and plugin timings with p50/p95/p99 percentiles. Retention windows for both errors and performance can now be tuned independently.
- 47bafcd: Unified the app's error pages — 404, 500, and feature fallbacks — under a shared, translatable error page with status pill, mono code, eyebrow, and a collapsible technical details card.
- 8da81a6: Improved the home page error fallback with distinct copy and recovery actions for sign-in, offline, upstream, and unknown failures.
- 8da81a6: Redesigned the row error states with a clearer panel for failed rows and a new inline card when pagination fails so people can retry just the missing page.
- a3e4fc3: Settings tabs now show live account, session, connection, MCP client, notification, and account-deletion data.
- 2fb20d9: Settings and admin now share the main app top bar, and admin moved to its own /admin section so the settings sidebar fits on a desktop.
- 2fb20d9: Redesigned the settings shell with a grouped sidebar, sticky save bar, and a refreshed look-and-feel for the Profile, Security, Connections, Notifications, Authorized apps, and Danger zone pages.
- 2e4697e: Unified the home and library row layout under a shared editorial header with prev/next scroll buttons.
- a3e4fc3: Hid notification-only plugins (Telegram, Discord, ntfy) from the Connections settings page so each section owns a disjoint set of plugins. They now appear only on the Notifications settings page.
- 2e4697e: Added an editorial watchlist page with curated tonight pick, mood mosaic, coming-up calendar strip, awaiting grid, and recently-added log.
- 2e4697e: Migrated the watchlist filter chips and sort dropdown to shadcn primitives, wrapped the page in an error boundary, and removed the duplicate date strip above each Coming Up card.

### Patch Changes

- ce2b0c5: Made the admin diagnostics page mobile-friendly and synced the pinned request id between the Errors and Performance tabs through the URL.
- ce2b0c5: Excluded the admin diagnostics namespace from HTTP perf capture so polling the Performance tab no longer skews its own samples, and made the perf aggregate endpoint honour the pinned request-id filter.
- ce2b0c5: Fixed diagnostics error rows storing raw URL paths (instead of the parameterised Hono route) and exhaustive test coverage for the retention sweep, plus hardening on the LIKE search and credential scrubber.
- ce2b0c5: Translated the admin diagnostics page into Persian and switched its UI to design-system tokens.
- a3e4fc3: Fixed the notification channel "Test" toast, which previously always reported success because the endpoint returns HTTP 200 even when the probe fails. The client now reads the response body and surfaces the plugin's diagnostic (e.g. "telegram bot token rejected") as an error toast.
- 2e4697e: Fixed the notifications bell popover not scrolling on desktop when the inbox exceeded the popover height.
- a3e4fc3: Fixed several issues in the settings wiring: failed connection tests now surface as errors instead of success toasts, bulk-revoke of authorized apps no longer leaves the cache in an inconsistent state on partial failure, the edit channel dialog no longer leaks state between channels, and profile saves no longer refetch the entire query tree.
- a3e4fc3: The current-password error banner on the security settings page now clears as soon as the user re-types in the field, instead of lingering until the next submit attempt.
- Updated dependencies [ce2b0c5]
  - @ent-mcp/shared@0.1.2

## 0.4.0

### Minor Changes

- 133cce0: Replaced custom keydown handling with TanStack Hotkeys, added vim-style page jumps (g h, g l, …) and a shortcuts cheatsheet, turned theme and locale into inline drill-in pickers, and wired command menu search to the live `/api/search` endpoint.
- bbf1c2e: Detail modal now renders summary fields instantly from row and hero caches while the full details fetch is in flight.
- 018fcab: The hero now showcases a mix of continue-watching, recommended, trending, and new-release titles instead of repeating one source, with a per-slide source label that updates as the carousel cycles.
- 5e66a73: Added a notifications page so you can browse, filter, and manage everything sent to you, plus pick which channels each category goes to.
- 6831fb5: Pending request status now survives reloads, displays "awaiting approval" when an admin approval is required, and supports server-side cancellation.
- 6831fb5: Request submissions now hit the server, with quality-profile choices loaded from the configured request services.

### Patch Changes

- 300b96a: The home hero now bleeds an ambient glow behind the rows below it, the detail modal sizes to its content with a fixed cinematic backdrop, and notifications and the modal hide their scrollbars while still scrolling normally.
- d8bfbf6: Fixed a crash on the home page when an old cached layout blob was served after the hero shape changed in the previous release; the home layout cache now invalidates those stale entries on first read.
- 5e66a73: Job trigger dialog now renders enum fields as a select dropdown instead of a free-text input.
- 5e66a73: Job trigger dialog now enforces required fields client-side, marking them with an asterisk and blocking submit until they are filled.
- 5e66a73: Hardened notifications surfaces against unsafe action URLs and tightened error handling for retention, channel deletion, and delivery retries.
- 5e66a73: Localized remaining notification surface strings, surfaced bulk inbox delete failures, and added test coverage for inbox, settings, admin, and shared notification helpers.
- 97eb2b3: Fixed a crash where the season list could throw "Rendered more hooks than during the previous render" when seasons loaded from empty to populated.

## 0.3.0

### Minor Changes

- 53e7452: Replaced the bottom navigation bar with a sticky top navigation bar that floats as a pill when the page is scrolled.
- 2266a1a: Added a command menu (⌘K, Ctrl+K, or /) for jumping between pages, searching shows and movies, and running quick actions.
- 2e96a06: Polished the media detail page: a fixed cinematic backdrop now fades into the page as you scroll, the modal hero fades the same way, the seasons list collapses cleanly for announced seasons, the section nav reliably highlights the section you're on, and the command palette footer adapts to touch devices and shows the brand logo.
- bf7a4b5: Reshaped the home-feed wire format with typed match reasons, library availability, display facets, and series context, and laid the server-side foundation for the upcoming `home.getLayout` / `home.getRowContent` endpoints.
- b50a9db: Added bottom navigation bar and top navigation tabs for Home, Library, and Watchlist.
- fcc2e4e: Connected the home page to the live media-feed backend; replaced the mock data with real recommendations, resumable progress, and per-row pagination served by new `home.getLayout`, `home.getRowContent`, and `home.getDetails` endpoints.
- 3d9f3e5: Added media row and card components to the home feed so mock content renders below the hero.
- d4f4e18: Added home feed feature scaffold with types, mock data, and routing.
- 364394a: Added a hero section to the home page and a detail modal that opens when you select a title.
- 65e53e2: Added internationalization support and translated the notification panel into English and Persian.
- 5ad74de: Enriched media detail modal with full episode data, TV air info, and availability-aware actions.
- 5ad74de: Redesigned the media detail modal with a cinematic full-bleed backdrop, sticky frosted top bar, scroll-driven title shrink, score cards, format chips, and a "why this" callout.
- 6b8e0cc: Added a full-page media detail view with cinematic hero, sticky section navigation, two-column body, scores and facts sidebar, and a related row.
- eefa990: Port the nama-prototype home design end-to-end: card art with clearLogo and server-name availability badges, hover quick-action and treatment-aware meta; row carousels with edge fades, hover scroll arrows, and mock infinite pagination; hero TopZone overlaid on a parallaxing backdrop with kicker, dismiss/cycle and match-reason; bottom nav that hides on scroll-down; media detail modal that becomes a bottom sheet on mobile with a wired trailer button.
- f883799: Added a notification panel for browsing, filtering, and dismissing in-app notifications.
- a94d9b3: Added the request flow on media detail surfaces — a server and quality picker for missing movies, and per-season requesting (with bulk "Request all") for partially available shows. Pending requests show an "Awaiting approval" badge users can cancel.
- b551a98: Removed the TanStack DB client data layer and reverted the admin jobs page to its previous behavior.
- 2b70a07: Restored the season list to the TV detail modal with per-server episode availability across connected Plex and Jellyfin libraries.

### Patch Changes

- a31896c: Cards, hero, detail modal, and detail hero now render the wire `clearLogo` image when available, falling back to the existing wordmark text. The detail page hero no longer falls back to the poster when a backdrop is missing — it stays empty so the cinematic backdrop never degrades to a stretched portrait.
- b08967f: Restored the bounded hero card with elevated shadow and YouTube-style ambient glow on the home page.
- 12482dd: Polished the home page so the hero halo blends naturally, progress bars sit at the edge of the artwork instead of breaking the image, the docked top nav stays readable on light backdrops, the bottom nav scales gracefully on small screens, and content rows align cleanly with the page grid.
- abba496: Fixed the home page scrolling back to the top when opening or closing a title's peek modal, added open and close animations to the peek modal, and capped the hero card at 60% of the screen height on phones so the rails below stay visible.
- 1807e51: Tighten home page visual fidelity to the nama-prototype reference: split hero clear-logo from the suggestion headline (logo becomes a small mono kicker, the show title becomes the H1), expose `Resume` + progress bar when the hero has watch progress, surface the brand wordmark next to the logo in the top nav (now driven by `home_nav_brand_label`), and add per-row `headerKey`/`subtitleKey` overrides on `RowData` so the second `continueWatching`, `recommendedForYou-tv`, and `recommendedForYou-movies` rows read as "Next in your shows", "TV shows to request", and "Movies to request".
- 5ad74de: Fixed the media detail modal so it no longer shows fabricated season episode counts, and corrected the rating vote count to read naturally for fewer than a thousand votes.
- 5ad74de: Localized the media detail modal's season subline and Watch action so they translate alongside the rest of the surface.
- 5ad74de: Tightened the media detail modal so the cinematic hero stays legible, the rating no longer duplicates between the meta line and the score card, and the recommendation rationale surfaces in the modal again.

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

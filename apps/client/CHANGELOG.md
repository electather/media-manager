# @nama/client

## 0.9.0

### Minor Changes

- 3dae961: The TMDB onboarding step is now optional when a bundled default key is available, and the shared credentials list shows the bundled default as a read-only entry your own key overrides.
- c786826: Added inline retry when loading more items fails across notifications, watchlist, and library lists.

### Patch Changes

- 26ec569: Dimmed the diagnostics filter bars while a filter or search change is loading so slow updates no longer look idle.
- 94508fc: Fixed home-feed cards without a click override so clicking one again opens its detail page.
- 94508fc: Sped up initial load by deferring the notification markdown renderer and device-info parser until they are actually needed.
- cb0bf0a: Added loading and error states to the setup wizard so it no longer flashes blank or crashes when configuration fails to load.
- 1d147f4: Fixed `isSearchKey` incorrectly accepting invalid `SearchKind` strings in the command-menu type guard.
- 94508fc: Translated the account menu links so they follow the selected language.
- 4b0b17a: Fixed IP address briefly appearing for sessions with unrecognized user agents during page load.
- e30658d: Notification images now only render from safe http(s) URLs, blocking tracking beacons and other unsafe schemes.
- 903e427: Fixed a browser hang caused by a zero step value in cron expressions like `*/0`.

## 0.8.0

### Minor Changes

- 39a5a51: Relaxed the password requirement to 8 characters while now requiring at least one letter and one number.

### Patch Changes

- 1c3bf42: Localized the library error message and stopped showing raw server diagnostic text when a page fails to load.
- 6f34ec2: Fixed the library error screen's retry so it refreshes the failed lens instead of every cached media view.

## 0.7.0

### Minor Changes

- e2cfc15: Added a picker for choosing which provider drives metadata details per media type.
- b00a33e: Added admin invite links so administrators can generate shareable URLs that let new users register directly.
- da76901: Replaced the login page's decorative poster grid with live trending artwork, falling back to bundled branded art so it never appears blank.
- b705484: Added hidden sourcemap support to the diagnostics pipeline: the client build emits hidden maps and keeps them out of the public asset directory, and the server accepts map uploads and resolves minified stack frames to original source positions. Maps for superseded builds are pruned automatically so storage stays bounded.
- d4b2228: Removed the per-bucket count pips from the watchlist filter, which now uses plain navigable bucket tabs, and dropped the backing media counts endpoint that no longer had a consumer.
- 2b578ff: Command menu recents now sync across tabs in real time.
- e7e4fa6: Added global client-side authorization with route guards, nav visibility control, and a Can component.
- e6a4dec: Added a real watchlist page backed by an internal store that syncs with plugins, replacing the previous mock-data placeholder.
- e201964: Tonight pick and mood clusters on the watchlist now lean on the standard watchlist card style, with logo artwork on wide cards and a clean, consistent thumb-and-title row for the rest. Mood clusters fill their preview pages reliably even when a mood is sparse.
- e201964: Watchlist mood pages now name the mood in the page header and offer a back link to the watchlist overview.
- e201964: Watchlist page now keeps the filter chips and sort dropdown in the header, opens a dedicated grid for each filter, shows in-progress titles in their own bucket, offers a flat "View all" page with sortable, paginated browsing of every item, and a dedicated "See all" page for each mood cluster.
- dc007d6: Paginated the watchlist with a keyset cursor, added a dedicated counts endpoint for the header pips, and let the bucket filter short-circuit enrichment on the server.
- a20c48b: Added a guided first-install setup: a one-time console token creates the first administrator, then an onboarding wizard configures the TMDB metadata key and optional service connections before entering the app.
- 7df63c0: Fixed diagnostics filters so clearing every severity or source shows no records, corrected the p99 latency card, surfaced retention update failures, kept error-detail failures contained, and added a deep link to individual slow requests.
- d4b2228: Added a Library page for browsing your catalog by index, era, collection, server, or quality, with search and URL-shareable faceted filters.
- adaf118: The library page now browses your real owned collection across all five lenses with infinite scroll, quality chips, and faceted filters.
- df5a127: Long watchlist and mood lists now load more titles automatically as you scroll near the end, keeping them smooth.
- df5a127: Media data for the home feed, watchlist, and title details is now served from one unified API. Watchlist items saved before this release may need to be scrolled to the top once, as in-progress pagination resets on deploy.
- df5a127: Watchlist pages now prefetch their first page on navigation, so sections show content on first paint instead of a loading spinner.
- 7490b5c: Added an MCP setup guide step to the onboarding wizard so new admins can connect Claude Desktop, Cursor, or any MCP-compatible client during first-install setup.
- 230b522: Redesigned the authentication screen using an animated 3D poster grid background and sleek glassmorphic controls.
- a8cae87: Raised the minimum password length to 12 characters (and capped it at 256) for new accounts and first-time setup.
- e6def93: Virtualized home feed and watchlist card grids so scrolling stays smooth on long lists.
- e201964: Added an "Unavailable" filter for watchlisted items that aren't on a connected media server. Sub-pages now show a content-shaped loading state and a clearer empty state explaining why a section is empty, and the active filter chip survives changing the sort order.

### Patch Changes

- 5884c6f: Fixed XSS vulnerability in notification popover: action URLs are now validated to allow only http/https schemes.
- e2cfc15: Improved the primary-provider picker error handling so deleted-connection and unsupported-capability errors show distinct toasts and refresh the relevant state.
- 8e091bd: Fixed a missing 100-character upper bound on user name fields in the invite, bootstrap, and admin user create and update flows.
- 222408e: Fixed whitespace-only user names being accepted by trimming name fields before length validation.
- 150df3c: Fixed stale JSDoc, dead i18n keys, and deprecated Zod schema form in the invites feature; extracted duplicated expiry helpers; aligned design doc error code with implementation.
- 6d1de34: Tightened the `AdminSettingsBody` type to reject empty objects at compile time.
- 97a0a81: Replaced `disabled` with `aria-disabled` on vote and note buttons in the media detail feedback bar so keyboard and screen-reader users can discover and tab to them.
- a20c48b: Fixed the first-install setup form getting stuck after creating the administrator when sign-in was slow, now sending you to the login page instead.
- df5a127: Connections that are working normally no longer show a status label; only connections needing attention are flagged.
- 5bfc436: Added a host hint in the device-code panel when the verification URL is rejected as unsafe, so the panel no longer appears broken if a future plugin returns a non-https URL.
- 4704216: Fixed the diagnostics error detail sheet staying frozen on the error fallback when selecting a different row after a fetch failure.
- 8f72773: Restricted the diagnostics pages and their menu entry to server administrators.
- e6def93: Fixed mobile drawers (including the content peek modal) not scrolling when their body exceeded the popup height.
- 29b08b2: Translated all Persian (fa) admin locale keys from English placeholders to Farsi.
- 2cf9967: Restricted post-login redirect to same-origin paths, preventing open-redirect and javascript: URI attacks via a crafted ?redirect= parameter.
- 49f25cb: Stopped reporting expected view-transition aborts (navigation, hidden tab, DOM-update timeout) as runtime errors.
- 1a0b51c: Library filters now narrow by every selected value, ordered quality options by fidelity, and showed a clear message instead of raw diagnostic text when a view failed to load. Hardened the title details endpoint against arbitrary lookups.
- 0c27013: Fixed the all-permissions badge in the roles list to correctly identify any role with wildcard permissions, and corrected whitespace-only header values being accepted silently in the plugin security settings.
- 39667ea: Fixed admin user role changes reflecting immediately in the detail view, removed a stale type cast in the admin users data fetcher, and deduplicated invite/admin predicate logic.
- f203b05: Fixed duplicate submit race on auth forms after successful login or registration, inconsistent disabled state between inputs and submit button, untrimmed name submitted on registration, and surfaced OAuth provider errors on the login page after a failed social sign-in redirect.
- 2b578ff: Fixed search scope switch showing stale results from the previous scope in the command menu.
- 766caad: Fixed the connection setup form so a successful test no longer stays marked verified after you change a field, and hardened OAuth sign-in against unsafe redirect links.
- d69f23f: Fixed the job trigger dialog to show an error toast on failure and submit numeric fields as numbers.
- 5459356: Fixed a security issue where notification toast action URLs were not validated before navigation, and corrected stale form state and incomplete validation in the admin retention settings.
- 4e8c55c: Disabled unimplemented vote, note, and watch controls in media detail to prevent silent discard of user input.
- d7e2de7: Fixed stale test/save badges persisting after the TMDB API key input is edited.
- aa4d608: Fixed a request that could no longer be cancelled after it was submitted.
- 1d449af: Improved partial app-revoke feedback, added email format validation before change confirmation, and localized remaining hard-coded strings in sessions and settings views.
- 148fddd: Localized the password reveal toggle in account settings so screen readers announce it in the active language.
- 3fa49a7: Fixed notification channel category toggles so selecting several at once saves reliably, and showed guidance when no channels exist yet.
- 50d0719: Fixed the security settings page so a malformed session list surfaces a clear error instead of showing invalid dates.
- d20b06f: Fixed mood cluster errors silently hiding behind a blank card instead of showing a retry prompt.
- 99b0052: Fixed the NoteButton in the media detail feedback bar to show a muted disabled style when a note exists, preventing a misleading highlighted appearance while persistence is not yet wired.
- 278754c: Scoped the diagnostics error boundary retry to the failing surface's queries only, preventing unrelated tabs from re-suspending on retry.
- 1576513: Capped `rid` to 64 characters and `pid` to 128 characters in the admin diagnostics search params to reject oversized values before they reach the server.
- 2198af3: Fixed command menu search key guard to require the `q` property, preventing stale placeholder data from being returned for incomplete keys.
- cfe4328: Fixed the OAuth error banner persisting in bookmarked or shared login URLs by removing the ?error param from the URL immediately after it is read.
- 73f4829: Added charset validation to the `pid` search param in the admin diagnostics route to reject values containing characters outside the alphanumeric, hyphen, and underscore set.
- 549dfc7: Added whitespace trimming to user name fields across all account creation and update paths.
- a5a70f8: Fixed missing skeleton block in performance detail sheet loading state.
- 5ad3b34: Fixed skeleton flashing on filter and search changes in the diagnostics errors and performance tabs.
- a20c48b: Fixed a blank home page after first-install setup by warming trending content as soon as onboarding finishes and showing a brief setup state until it loads.
- e2cfc15: Restored spacing between cards in home and watchlist rows.
- 9b795fc: Fixed decimal values and integer fields being dropped in the job trigger dialog numeric inputs.
- df5a127: Fixed watchlist items in mood clusters showing as "not on your watchlist" when opened from a peek.
- 3116c12: Fixed the media detail peek modal reopening when pressing the browser back button.
- fdca01d: Stabilized the media detail peek modal when the `?peek=` search param toggles rapidly (browser back/forward or fast link clicks).
- df5a127: Fixed the Reconnect button so it re-runs the sign-in flow for an expired or broken connection instead of only reopening the edit dialog.
- 58fe733: Fixed the top navigation pill triggering an infinite re-render loop when the active link did not change size or position.
- df5a127: The hero carousel dots are now display-only position indicators rather than clickable controls.
- df5a127: Home rows with no items now collapse instead of leaving an empty gap in the feed.
- 893d134: Fixed invite sign-up edge cases and now show a clear "no longer valid" message when an invite expires or is revoked while someone is completing it.
- 8433a0c: Adjusted mood cluster header text sizes to align with the standard design scale.
- 07f9f96: Members with no setup steps now see a clear "nothing to configure" finish screen during onboarding instead of an empty wizard.
- e6def93: Fixed the home hero card briefly floating over the content peek modal while it opened.
- ede9e2e: Fixed performance detail sheet rendering blank on fetch error by wrapping it in an error boundary with a retry affordance.
- 38ddcea: Aligned the performance detail sheet loading skeleton to show three blocks, matching the error detail sheet's skeleton layout.
- 8f72773: Added removeOnEmpty option to rollbackQuery so stale optimistic writes are cleaned up when the cache was empty before the mutation.
- d4b2228: Restyled the watchlist filters as segmented tabs that match the library lens switcher, so the two pages share one consistent header.
- b1191d1: Removed the redundant load-more button from the watchlist all-items and mood views, leaving infinite scroll as the single way to page through results.
- e6def93: Fixed the home card add-to-watchlist button not appearing to do anything when the watchlist page had not been opened yet in the session.
- d58cafe: Watchlist cards and loading placeholders now match the rest of the app, and watchlist items without a logo no longer show their title as a stand-in wordmark.

## 0.6.0

### Minor Changes

- e80b956: Fresh notifications now surface as in-app toasts when you're on the page, with click-to-open and dismiss actions.
- 8a9f3f5: The "More like this" section on media detail pages now fetches items similar to the current title instead of a generic recommendation feed.
- 4d9f95d: Added request actions to TV seasons on the media detail page, with a disabled "No plugin configured" affordance when no request service is available.

### Patch Changes

- 536f4aa: Fixed admin plugin personal-key fallback controls for shared user-scoped plugins.
- ee5a02b: Fixed shared credential metadata edits so the existing credential is tested before saving.
- a389685: Improved logo contrast when using light mode.
- c1bf5c2: Improved localized time and duration formatting across the client.
- 0813d5b: Surfaced partial media detail warnings when provider details failed.
- a389685: Removed the "+N more" cluster toast; bursts of new notifications now stack individually and rely on the toaster's native grouping.
- a389685: Fixed home hero overlays so availability and ambient glow no longer crowd the copy.
- a389685: Rebound the theme picker shortcut to Mod+Alt+T so it no longer clashes with the browser's "reopen closed tab" binding.
- a389685: Fixed the top navigation scrim so it adapts to light and dark themes.
- a389685: Fixed the home hero ambient backdrop crossfade so switching highlights no longer doubled the glow.
- a389685: Fixed the hero carousel snapping back to the first slide when pressing More Info, made slide swaps feel snappier by preloading the next backdrop and deferring the ambient blur, and removed the duplicate movie title that repeated the clear logo artwork.
- a389685: Fixed theme switching so light and dark mode persist without a first-paint flash.

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
  - @nama/shared@0.1.2

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
  - @nama/shared@0.1.1

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
  - @nama/shared@0.1.0

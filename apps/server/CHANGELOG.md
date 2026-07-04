# @nama/server

## 0.9.1

### Patch Changes

- 476ed4c: Fixed the login/bootstrap poster background showing only half-filled rows by storing enough trending titles to fill the grid.
- Updated dependencies [476ed4c]
  - @nama/plugin-tmdb@0.5.1

## 0.9.0

### Minor Changes

- 3dae961: Built-in plugins can now ship a bundled default key, so artwork and metadata work before you add your own credentials.
- c4b3ca4: Seeded the discover snapshot synchronously at server startup so the home feed has data available immediately on first boot or after a restart.

### Patch Changes

- 42a3437: Secured per-user activity endpoints behind session authentication.
- a9b89a5: Fixed admin-set plugin headers being silently lost when edited from a different server worker than the one that last cached them.
- 72f824a: Fixed a race condition where sourcemaps for a concurrently uploaded build could be deleted during retention sweeps.
- 0b6047b: Capped plugin-supplied retryAfterMs to 24 hours so a buggy or malicious plugin cannot push delivery retries arbitrarily far into the future.
- 3dbeab4: Capped per-request sourcemap bundle fan-out at 20 files and enlarged the parsed-map LRU cache to prevent attacker-influenced stacks from amplifying database reads.
- 2f10326: Fixed the diagnostics error summary failing to load.
- a1d02aa: Added per-user rate limiting to connection verify, test, and OAuth endpoints to prevent cross-user exhaustion of the shared plugin fetch quota.
- cf990ad: Enforced the password policy when changing your password so weak passwords can no longer be set.
- f87f39b: Enforced the display-name length limit when a social or OAuth profile is re-synced on subsequent logins.
- a587188: Fixed encryption failing with RangeError when encrypting large plaintexts.
- 0733d2a: Fixed repeated calls to complete onboarding from triggering the discover-snapshot job more than once.
- 0745d94: Fixed per-row job handlers receiving an AbortSignal that fires on timeout so they can stop processing promptly.
- 19953f1: Capped the number of HTTP perf rows loaded by the `/admin/diagnostics/perf/summary` endpoint to prevent unbounded memory use over a 24-hour window.
- e3eac49: Fixed a race where the metadata prune could evict catalog entries that were accessed while the sweep was running.
- f1b810b: Fixed request eligibility incorrectly shown for items already available or when no request providers were registered.
- b9f16ec: Password policy is now enforced on the reset-password path in addition to change-password.
- 1cc0f91: Fixed a race where concurrent library syncs for the same user could wrongly mark owned titles as removed.
- df0c9c6: Fixed a bug where a single undecryptable admin credential row would abort the entire plugin credential pool; corrupted rows are now skipped with a warning.
- 9ce8d35: Blocked plugin requests whose hostname resolves to a loopback, link-local, or cloud metadata address, closing a server-side request forgery gap.
- c66c2f1: Replaced raw error message in unhandled 500 responses with a generic string to prevent internal details leaking to clients.
- e1cfc43: Fixed over-long social sign-in display names being truncated mid-emoji, which left a broken character in the stored name.
- d4724a0: Hardened library sync so overlapping runs can no longer drop a title from your owned library.
- Updated dependencies [3dae961]
- Updated dependencies [3dae961]
- Updated dependencies [e5e3990]
- Updated dependencies [4d13bfe]
- Updated dependencies [0a202a8]
- Updated dependencies [d97366e]
  - @nama/plugin-sdk@0.6.0
  - @nama/plugin-tmdb@0.5.0
  - @nama/plugin-jellyfin@0.3.4
  - @nama/plugin-plex@0.3.4
  - @nama/plugin-seerr@0.3.3
  - @nama/plugin-discord@0.2.5
  - @nama/plugin-fanart@0.2.1
  - @nama/plugin-inbox@0.2.5
  - @nama/plugin-ntfy@0.2.5
  - @nama/plugin-telegram@0.2.5
  - @nama/plugin-trakt@0.2.5
  - @nama/plugin-tvdb@0.2.5

## 0.8.0

### Minor Changes

- 39a5a51: Relaxed the password requirement to 8 characters while now requiring at least one letter and one number.

## 0.7.0

### Minor Changes

- e2cfc15: Added a picker for choosing which provider drives metadata details per media type.
- b00a33e: Added admin invite links so administrators can generate shareable URLs that let new users register directly.
- 4afff12: Tightened backend module boundaries with fallow-enforced per-module zones, barrel-only public APIs, table-ownership pre-commit script, and file-size caps.
- 71b14c3: Introduced a typed event bus for cross-module signals and migrated notifications to the new modular monolith layout.
- 2e89f2d: Migrated preferences to the new modular monolith layout behind a `PreferencesService` facade.
- 9565f88: Retrofitted auth module to flat-with-reserved-files layout; barrel-only public API unchanged.
- da76901: Replaced the login page's decorative poster grid with live trending artwork, falling back to bundled branded art so it never appears blank.
- b705484: Added hidden sourcemap support to the diagnostics pipeline: the client build emits hidden maps and keeps them out of the public asset directory, and the server accepts map uploads and resolves minified stack frames to original source positions. Maps for superseded builds are pruned automatically so storage stays bounded.
- d4b2228: Removed the per-bucket count pips from the watchlist filter, which now uses plain navigable bucket tabs, and dropped the backing media counts endpoint that no longer had a consumer.
- f0cba8f: Extracted active-row storage into a dedicated media module with keyset pagination, cursor encoding, and seed-lock primitives.
- e6a4dec: Added a real watchlist page backed by an internal store that syncs with plugins, replacing the previous mock-data placeholder.
- e201964: Split the watchlist API into per-section endpoints (counts, tonight, recently, moods, items) so each surface can load and invalidate independently.
- dc007d6: Paginated the watchlist with a keyset cursor, added a dedicated counts endpoint for the header pips, and let the bucket filter short-circuit enrichment on the server.
- a20c48b: Added a guided first-install setup: a one-time console token creates the first administrator, then an onboarding wizard configures the TMDB metadata key and optional service connections before entering the app.
- 0973469: Registered the fanart.tv plugin so admins can configure a fanart API key and the home feed picks up HD posters, backdrops, and clear logos from fanart.tv.
- adaf118: Added a media library that tracks the titles you own and keeps the set in sync with your collection providers.
- dacd382: Media items now expose when and how a title was added to the watchlist (added date and source).
- df5a127: Media data for the home feed, watchlist, and title details is now served from one unified API. Watchlist items saved before this release may need to be scrolled to the top once, as in-progress pagination resets on deploy.
- 7490b5c: Added an MCP setup guide step to the onboarding wizard so new admins can connect Claude Desktop, Cursor, or any MCP-compatible client during first-install setup.
- 05c6f6d: Added `ArtworkServiceError` and `ARTWORK_EVENTS` to the artwork module's public API.
- 1df99dd: Restructured the home module to the canonical flat-with-reserved-files layout. The public barrel now exports `HOME_EVENTS` and `HomeServiceError`; the temporary `registerHomeLayoutWarmJob` job-function export was removed in favour of the standard `registerJobs` entry point. Behaviour is unchanged.
- b15aa53: Added a per-IP rate limit to the public, session-less endpoints.
- 39358cc: Added a stable identifier to the built-in Admin role so renaming it no longer breaks admin permissions.
- a8cae87: Raised the minimum password length to 12 characters (and capped it at 256) for new accounts and first-time setup.

### Patch Changes

- 97c76a7: Fixed admin-configured request headers leaking to user-controlled plugin endpoints.
- 0b8452d: Fixed SSRF via redirect: plugin fetches now reject 3xx responses instead of following them to unvalidated hosts.
- 944d43b: Fixed privilege escalation: the role assignment endpoint now rejects attempts to assign system-protected roles.
- 7a4241a: Fixed account-deletion password verification to fail-closed on unknown Better Auth response shapes while still accepting the actual `{ status: true }` success contract.
- 8a345d3: Fixed verify-config to strip x-plugin-resolved fields before passing user config to plugin auth, matching the create-connection path.
- c9b4690: Fixed admin revoke-sessions to also invalidate OAuth access tokens, refresh tokens, and consent grants, not just web sessions.
- 393a136: Fixed unbounded data-export requests letting a single user exhaust memory by adding a per-user 5/hour rate limit to `/me/export` (429 + `Retry-After`).
- d8fc41c: Added per-user rate limiting to the artwork RPC endpoint to prevent shared TMDB quota exhaustion. Throttled responses return HTTP 429 with a `Retry-After` header, and the limiter charges tokens per unique canonical lookup so batched requests cost what they actually cost downstream.
- 7dbbbc7: Fixed internal error messages (SQL fragments, file paths) leaking to authenticated MCP clients via devMessage.
- b50862e: Fixed email-change notification to read previous email from the database instead of relying on Better Auth internal hook context shape.
- 37bc35e: Fixed Trakt token refresh treating rate-limit responses as expired credentials; the connection no longer flips to "reconnect required" when Trakt returns 429, and the per-connection job runner now honours the rate-limit cooldown before retrying.
- a42c53c: Fixed background token refreshes (e.g. Trakt) marking the connection as a generic "error" instead of "expired" — the connections view now shows the "Reconnect" prompt when the upstream revokes a refresh token.
- 66af0e3: Fixed a prototype pollution vulnerability in the `primary_with_enrichment` media dispatch strategy: plugin responses carrying an own `__proto__`, `constructor`, or `prototype` key are now filtered before they reach the recursive merge, so a malicious enrichment payload cannot pollute the worker's `Object.prototype`.
- ac654bf: Fixed a race in the primary-connection preference write that could surface a 500 when two requests for the same capability arrived concurrently.
- e2cfc15: Fixed the primary-provider picker so selecting "Auto" actually clears the saved preference.
- c00adf7: Stopped corrupt connection settings from flooding the server logs with repeated warnings.
- 8e091bd: Fixed a missing 100-character upper bound on user name fields in the invite, bootstrap, and admin user create and update flows.
- 222408e: Fixed whitespace-only user names being accepted by trimming name fields before length validation.
- 150df3c: Fixed stale JSDoc, dead i18n keys, and deprecated Zod schema form in the invites feature; extracted duplicated expiry helpers; aligned design doc error code with implementation.
- 0163c64: Reset emailVerified to false when an admin changes a user's email address.
- ce37c0c: Closed a privilege-escalation gap: the admin user-creation and role-assignment endpoints now reject any role granting admin-tier permissions, not just the built-in admin role.
- 9663f90: Centralised rate limiting behind a shared Hono middleware factory, removing per-handler inline rate-limit calls.
- f32d535: Added a 100-character upper bound to connection display names to prevent unbounded input reaching the database.
- 21d0bbf: Deleting a connection that does not exist or belongs to another user now returns a 404 error instead of silently succeeding.
- 8f72773: Restricted the diagnostics pages and their menu entry to server administrators.
- 19d875a: Fixed a TOCTOU race in pending auth completion that could create duplicate connection rows under concurrent OAuth callbacks.
- 265f4c6: Surfaced misconfigured email setups immediately. When the email-enabled flag was on but no email provider was wired, verification and password-reset emails silently dropped; the server now fails loudly so operators can fix the deployment before users hit the broken flow.
- 474e965: Fixed sensitive OAuth fields (`access_token`, `refresh_token`, `client_secret`, `code`, `code_verifier`) being exposed in debug logs.
- dabf866: Fixed `GET /api/requests` returning 500 when no mediaRequest provider is configured; it now returns an empty list, and `DELETE /api/requests/:id` surfaces 404 `request.no_provider` in the same scenario.
- 566cb1e: Fixed the manual preference rebuild trigger returning 500 instead of 400 when called without a userId.
- c0bb279: Fixed a corrupted or schema-invalid plugin manifest aborting startup job registration for every other plugin.
- ca03136: Fixed sparse bucket+sort combos returning fewer than `limit` items per page when matching rows fell outside the initial overshoot window.
- dacd382: Fixed info-only titles (released, not on a media server, and not requestable) appearing under Upcoming; they now appear under Unavailable.
- df5f5db: Fixed artwork lookups so rows pointing at the same title are counted once against the rate limit.
- f71ad44: Automatically removed abandoned OAuth clients that were never authorized to keep the connected-apps list and database from growing unchecked.
- f7c25e8: Fixed metadata refresh logging to report title removals and plugin failures as separate counters, so normal upstream removals no longer inflate the failure rate.
- 9940eaa: Fixed a corrupt connection no longer crashing the connections list, media playback, background jobs, or assistant tools, and renaming a connection now returns a proper error when the connection does not exist.
- 1a0b51c: Library filters now narrow by every selected value, ordered quality options by fidelity, and showed a clear message instead of raw diagnostic text when a view failed to load. Hardened the title details endpoint against arbitrary lookups.
- c9a8582: Fixed library sync crash for large collections and unbounded plugin fan-out during hydration.
- cdf6613: Fixed transient upstream errors from incorrectly marking a media connection as permanently degraded.
- 96a909d: Fixed notification delivery so a failed trigger for one recipient no longer prevents the remaining recipients from being triggered. Updating one notification retention window no longer resets the other.
- c7abb25: Hardened plugin networking against internal-address access and made plugin invocation resilient to corrupt stored configuration.
- 3c5ee65: Fixed neutral-sentiment notes incorrectly inflating profile sample size, kept long feedback notes intact while bounding the text scanned for sentiment, and deduplicated cold-fill catalog writes during rebuilds.
- 1005d8c: Fixed watchlist alphabetical sort to produce consistent ordering across all environments.
- 44da470: Fixed watchlist alpha sort to produce a consistent ordering for titles that differ only in letter case (e.g. "elite" vs "ELITE").
- b9ed0c6: Bounded the admin diagnostics request-id filter so oversized or malformed values are rejected at the API boundary instead of reaching the database.
- 3332209: `PATCH /api/admin/notifications/settings` now returns 400 when the request body contains no retention fields instead of silently returning 200 with unchanged values.
- 60c5863: Fixed `getAppConfig` and `getNotificationRetention` to always read the `global` row from `app_config`, guarding against a rogue second row returning wrong retention values.
- 5d583d5: Fixed connection default handling so that, when a connection is deleted or set as default at the same time as a concurrent change, the previous default is preserved and the operation reports a not-found error instead of leaving the plugin with no default connection.
- 717537d: Deduplicated corrupt userConfig warnings so each distinct row logs at most once per process lifetime instead of at request rate.
- fcabf5b: Removed userId from invite accept response to prevent information disclosure on the public unauthenticated endpoint.
- 549dfc7: Added whitespace trimming to user name fields across all account creation and update paths.
- 2c69b5c: Fixed the connection test handler to return not-found instead of silently writing to a deleted connection when the row is removed between the pre-check and the status update.
- cc47b68: Mapped `AllPluginsFailedError` to a 503 `media.providers_failed` response carrying per-provider `errors[]` so clients can render per-provider hints instead of a generic 500.
- 44454ba: Fixed boolean environment flags so setting them to "false" now correctly disables the feature instead of being treated as enabled.
- df5a127: Fixed the home "Coming up" row showing a load error for users who had not connected a calendar provider.
- df5a127: Stopped the home "Coming up" row from showing an error when a calendar source was only temporarily unavailable, and stopped a rate-limited sign-in refresh from prompting an unnecessary reconnect.
- 1cffb63: Scrubbed Bearer tokens, sensitive URL query params, and JWT strings from error messages and stack traces before persisting.
- 5fe55ad: Fixed a missing userId predicate in connection UPDATE/DELETE queries that allowed cross-tenant writes.
- 3afc99c: Stopped forwarding client-provided requestId to captureError so correlation IDs cannot be spoofed.
- d9e2d07: Fixed unauthenticated plugin invocations caused by connections with missing or corrupt credential ciphertext.
- a20c48b: Fixed a blank home page after first-install setup by warming trending content as soon as onboarding finishes and showing a brief setup state until it loads.
- 97a3e29: Added per-user rate limiting and payload size limits, including bounded context fields, to the frontend error reporting endpoint to prevent storage exhaustion.
- 4f6b1ba: Fixed the home hero carousel showing the same title twice when it appeared in more than one source pool.
- a9a4f2d: Fixed library hydration overwriting another user's watched progress and server availability when both owned the same title.
- 4ac97db: Fixed a resource leak in the job runner that permanently locked a job key when getConfig or startRun threw, preventing future runs without a process restart.
- 5876de8: Simplified the OAuth handler content-type guard so it correctly accepts charset suffixes.
- df5a127: Fixed Trakt and other linked accounts being incorrectly marked as expired when several requests refreshed an expired login at the same time.
- a623975: Rate-limited OAuth dynamic client registration to 5 attempts per hour per IP to protect against abuse while keeping unauthenticated MCP client discovery working.
- 0163c64: Fixed a race condition in job history pruning by using a single atomic statement.
- 83514e8: Fixed a race when several connections for the same service are created at the same time so a default connection is always selected.
- 853ecd3: Fixed rate limiter bypass where unknown-tool and missing-scope requests could skip per-user quota enforcement.
- df5a127: Fixed the Reconnect button so it re-runs the sign-in flow for an expired or broken connection instead of only reopening the edit dialog.
- 95bfbbe: Fixed plugins that declare their upstream URL on the admin-only global config (such as Seerr) being unable to reach their own server.
- 1f8f31a: Handled non-plain objects and invalid Dates in the diagnostics scrubber to avoid silent data loss.
- adb6fc1: Fixed a 500 error when a session was returned without a user; the server now responds with 401 in this case.
- 226e87e: Fixed FK violation in diagnostic DB sink when system jobs write perf and error records.
- b34ada0: Fixed unbounded memory growth in the request rate limiter, whose key table now evicts idle, fully-refilled buckets instead of keeping an entry per client forever.
- 5da6c92: Validated the incoming X-Request-Id header against a length and charset allowlist so malformed values no longer reach diagnostics tables.
- 5365b08: Fixed a single corrupted connection record no longer wiping out every linked app for a user.
- e051870: Fixed mood watchlist pagination so empty scans stopped offering another page.
- df5a127: Fixed watchlist entries that could no longer be matched to a title showing as a raw placeholder like "Movie 329367"; such entries are now hidden until they can be resolved.
- 7030b48: Fixed x-secret userConfig fields being stored plaintext for no-auth plugins by moving them into the encrypted credentials blob at connection creation.
- 893d134: Fixed invite sign-up edge cases and now show a clear "no longer valid" message when an invite expires or is revoked while someone is completing it.
- ec773cd: Malformed JWT sub or scope claims are now rejected with a 401 instead of propagating as invalid values.
- 1c7d854: Fixed null credentials being propagated to plugin handlers when ciphertext is missing or decryption fails.
- 9b3cdaf: Fixed OAuth/social sign-up bypassing the 100-character display name limit by truncating over-long names at user creation.
- 9a7653e: Fixed an internal job trigger reporting a missing job instead of an untriggerable one when a job was registered with the wrong kind.
- 995f9df: Fixed invalid combined media ids (including empty ids) being passed downstream instead of rejected, routed no-provider errors to an empty state instead of a server error, and made the home layout warm job stop retrying a slow or offline provider once it has failed repeatedly in a run.
- b41b9da: Fixed unauthenticated access to /api/settings by adding requireSession middleware to the settings router.
- 0c2d3d1: Fixed SSRF blocklist bypass where trailing-dot hostnames (e.g. localhost.) could bypass exact-match blocklist checks.
- 9c46f28: Accepted both trailing-slash and non-slash forms of the OAuth provider audience.
- 899d789: Fixed artwork write-back releasing a newer claim when an earlier patch failed after its dedup window lapsed.
- Updated dependencies [0362593]
- Updated dependencies [facb082]
- Updated dependencies [37bc35e]
- Updated dependencies [1b1c614]
- Updated dependencies [e38746e]
- Updated dependencies [68c85b3]
- Updated dependencies [68c85b3]
- Updated dependencies [0973469]
- Updated dependencies [a740007]
- Updated dependencies [08df5ef]
- Updated dependencies [3760b39]
- Updated dependencies [6207756]
- Updated dependencies [b45d0c6]
- Updated dependencies [95bfbbe]
- Updated dependencies [2e935ab]
- Updated dependencies [adaf118]
- Updated dependencies [0c472a1]
- Updated dependencies [adaf118]
  - @nama/plugin-seerr@0.3.2
  - @nama/plugin-ntfy@0.2.4
  - @nama/plugin-trakt@0.2.4
  - @nama/plugin-sdk@0.5.0
  - @nama/plugin-fanart@0.2.0
  - @nama/plugin-plex@0.3.3
  - @nama/plugin-discord@0.2.4
  - @nama/plugin-tvdb@0.2.4
  - @nama/plugin-tmdb@0.4.0
  - @nama/plugin-inbox@0.2.4
  - @nama/plugin-jellyfin@0.3.3
  - @nama/plugin-telegram@0.2.4

## 0.6.0

### Minor Changes

- 8a9f3f5: The "More like this" section on media detail pages now fetches items similar to the current title instead of a generic recommendation feed.

### Patch Changes

- e9510bf: Validated no-auth connection URLs before saving user-scoped plugin connections.
- 536f4aa: Fixed admin plugin personal-key fallback controls for shared user-scoped plugins.
- e80b956: Inbox listing now supports forward keyset pagination via an `after` query parameter.
- Updated dependencies [a389685]
  - @nama/plugin-tmdb@0.3.3

## 0.5.0

### Minor Changes

- ce2b0c5: Renamed the admin Errors page to Diagnostics and added a Performance tab that surfaces request and plugin timings with p50/p95/p99 percentiles. Retention windows for both errors and performance can now be tuned independently.
- a3e4fc3: Hid notification-only plugins (Telegram, Discord, ntfy) from the Connections settings page so each section owns a disjoint set of plugins. They now appear only on the Notifications settings page.

### Patch Changes

- ce2b0c5: Excluded the admin diagnostics namespace from HTTP perf capture so polling the Performance tab no longer skews its own samples, and made the perf aggregate endpoint honour the pinned request-id filter.
- ce2b0c5: Fixed diagnostics error rows storing raw URL paths (instead of the parameterised Hono route) and exhaustive test coverage for the retention sweep, plus hardening on the LIKE search and credential scrubber.
- 2e4697e: Renamed the home row stub `subtitleKey` field to `eyebrowKey` to match the editorial header redesign.
- a3e4fc3: Fixed adding a notification channel for plugins that declare `auth.kind: "none"` (Telegram, Discord, ntfy). Previously the server tried to call the plugin's `startAuth` regardless of auth kind, surfacing "plugin telegram does not export startAuth" to the user.
- a3e4fc3: Fixed notification delivery for third-party channel plugins (Telegram, Discord, ntfy, custom). The delivery job was forwarding the raw `service_connections.user_config` JSON text to each plugin's `deliver` and `testConnection` instead of the parsed object, so plugins reading e.g. `args.channelConfig.botToken` saw `undefined` and the call silently failed against the upstream. The job now parses `user_config` once at the boundary and threads the object through. Added tagged `consola` logs at every state transition (start, succeeded, rescheduled, failed, missing capability) so delivery failures are visible without inspecting the database.
- a3e4fc3: Fixed the notification channel test endpoint, which previously reported "plugin has no testConnection" with `ok: true` for every notification plugin (Telegram, Discord, ntfy, inbox) because those plugins declare `auth.kind: "none"` and expose their probe via `notificationDelivery.testDelivery` rather than a module-level `testConnection`. The runtime now falls back to the capability's probe so the test surfaces real upstream failures.
- a3e4fc3: Fixed notification delivery to fan out concurrently across recipients. The `notification.deliver` job had no scope key, so emitting an event with multiple subscribed channels (e.g. inbox + Telegram) serialized at the job-runner lock — the first delivery ran and the rest immediately failed with "job notification.deliver is already running". The job now scopes its lock by `deliveryId`, so each channel's delivery runs in parallel and independently.
- a3e4fc3: Notification deliveries now fail loudly with a precise error code when a channel's stored configuration cannot be parsed, instead of handing a raw string to the plugin and surfacing the failure as a cryptic upstream error.
- 2e4697e: Fixed the upcoming row showing the same show multiple times when several queued episodes shared a calendar entry, which produced duplicate React keys and broke the home feed.
- Updated dependencies [ce2b0c5]
- Updated dependencies [a3e4fc3]
- Updated dependencies [a3e4fc3]
  - @nama/shared@0.1.2
  - @nama/plugin-telegram@0.2.3
  - @nama/plugin-sdk@0.4.1
  - @nama/plugin-discord@0.2.3
  - @nama/plugin-inbox@0.2.3
  - @nama/plugin-ntfy@0.2.3
  - @nama/plugin-jellyfin@0.3.2
  - @nama/plugin-plex@0.3.2
  - @nama/plugin-seerr@0.3.1
  - @nama/plugin-tmdb@0.3.2
  - @nama/plugin-trakt@0.2.3
  - @nama/plugin-tvdb@0.2.3

## 0.4.0

### Minor Changes

- e2556c5: Added a search endpoint that powers live results in the command menu.
- 133cce0: Wired the `/api/discover/trending` endpoint so the command menu can list live trending TV shows and movies.
- 018fcab: The hero now showcases a mix of continue-watching, recommended, trending, and new-release titles instead of repeating one source, with a per-slide source label that updates as the carousel cycles.
- 5e66a73: Added an admin job that sends a demo notification to any user, useful for verifying the notifications setup.
- 5e66a73: Notifications are now enabled by default.
- 6831fb5: Pending request status now survives reloads, displays "awaiting approval" when an admin approval is required, and supports server-side cancellation.
- 6831fb5: Wired the request-submission API and added a target-listing endpoint that aggregates configured request services.

### Patch Changes

- d8bfbf6: Fixed a crash on the home page when an old cached layout blob was served after the hero shape changed in the previous release; the home layout cache now invalidates those stale entries on first read.
- 5e66a73: Demo notification job now lets admins pick the event type instead of the category, and builds a payload that matches the chosen type so the rendered notification reflects the selection.
- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
  - @nama/plugin-sdk@0.4.0
  - @nama/plugin-seerr@0.3.0
  - @nama/plugin-discord@0.2.2
  - @nama/plugin-inbox@0.2.2
  - @nama/plugin-jellyfin@0.3.1
  - @nama/plugin-ntfy@0.2.2
  - @nama/plugin-plex@0.3.1
  - @nama/plugin-telegram@0.2.2
  - @nama/plugin-tmdb@0.3.1
  - @nama/plugin-trakt@0.2.2
  - @nama/plugin-tvdb@0.2.2

## 0.3.0

### Minor Changes

- bf7a4b5: Reshaped the home-feed wire format with typed match reasons, library availability, display facets, and series context, and laid the server-side foundation for the upcoming `home.getLayout` / `home.getRowContent` endpoints.
- a31896c: Hide home rows that have no content for the current user, so an installed plugin with an empty feed (e.g. an empty watchlist) no longer ships an empty row to the client.
- fcc2e4e: Connected the home page to the live media-feed backend; replaced the mock data with real recommendations, resumable progress, and per-row pagination served by new `home.getLayout`, `home.getRowContent`, and `home.getDetails` endpoints.
- 2b70a07: Restored the season list to the TV detail modal with per-server episode availability across connected Plex and Jellyfin libraries.

### Patch Changes

- a31896c: Fixed the home feed so titles you watch on Jellyfin or Plex show up in the Continue Watching row and the hero, and so a card's "available on your server" state reflects what the server actually has rather than only what was requested through Seerr.
- a31896c: Fixed home feed issues: hero items and detail summaries now include availability and status fields so request-vs-play CTAs render correctly, and unified the home-feed error responses so wrong-method/unknown-route requests return JSON error envelopes instead of plain-text 404s.
- a31896c: Requests to the bare `/api` path now return the same JSON error envelope as other unknown API routes instead of falling through to the SPA handler.
- a31896c: Fixed missing hero and Continue Watching artwork on the home feed when canonical metadata already had poster, backdrop, and clear logo cached.
- a31896c: Fixed several home-feed availability issues: items not on a connected server no longer falsely report "available" when Jellyfin's TMDB filter is unsupported, your Trakt watchlist no longer disappears when an item has a missing IMDB id, and watchlist titles you have on Jellyfin now render even before the catalog has cached their metadata.
- a31896c: Sped up the home feed: each library plugin now publishes a one-shot list of TMDB ids it has on hand, and the server uses that index for every availability check in a request instead of probing one title at a time.
- 1340303: Job error logs now show plain string causes correctly instead of wrapping them in extra quotes.
- 1340303: Home rows now display poster, backdrop, and clear logo artwork from saved metadata, even when the upstream provider returned none.
- Updated dependencies [a31896c]
- Updated dependencies [a31896c]
- Updated dependencies [a31896c]
- Updated dependencies [2b70a07]
  - @nama/plugin-jellyfin@0.3.0
  - @nama/plugin-plex@0.3.0
  - @nama/plugin-trakt@0.2.1
  - @nama/plugin-sdk@0.3.0
  - @nama/plugin-tmdb@0.3.0
  - @nama/plugin-discord@0.2.1
  - @nama/plugin-inbox@0.2.1
  - @nama/plugin-ntfy@0.2.1
  - @nama/plugin-seerr@0.2.1
  - @nama/plugin-telegram@0.2.1
  - @nama/plugin-tvdb@0.2.1

## 0.2.0

### Minor Changes

- 0a9807f: Reduced repeat artwork lookups on the home feed by serving inline artwork URLs whenever they are already known and only fetching from external services when a slot is missing.
- db2b076: Added a batched artwork lookup so the home feed loads high-resolution posters and backdrops once cards are visible, with a graceful fallback to inline thumbnails while the lookup is in flight.
- aa85d35: The New Releases row on the home feed now serves from a daily snapshot, eliminating the cold-load latency users saw on every page visit.
- 84030cb: Recommendation rebuilds now read item features from a local catalog instead of TMDB on every run, removing the rate-limit pressure that slowed home loads.
- 36e2739: Personalized recommendations are now built nightly and served instantly, removing the wait users saw on every fresh visit.
- 1a8245a: Watch history and ratings now sync to a local copy in the background, so recommendations rebuild without re-querying every connected service.
- fc371c1: Added a Netflix-style home feed with seven curated rows, hero pick, opaque-cursor pagination, and graceful row-level degradation when plugins are missing or slow.
- 77ed7b0: Home feed layout now loads row structure instantly and fetches row items lazily per row.
- 3743af3: Added the in-app notification inbox so users can review activity alerts from one place.

### Patch Changes

- 986fb74: Added the foundation for high-quality artwork on the home feed: TMDB now returns posters, backdrops, and clear logos through a new artwork capability that future plugins can extend.
- 5f8d685: Catalog now trims unused entries automatically, keeping the local database lean over time.
- ca50c56: Recovered home feed performance — recommendations row, new releases row, and artwork batch now serve from cache on warm loads.
- db2b076: Fixed the home feed shrinking to a single row when one of its providers was slow or rate-limited. Slow rows now stay in the layout with a partial-content marker instead of disappearing.
- e9b915f: Each built-in integration (Trakt, TMDB, TVDB, Seerr, Plex, Jellyfin) is now its own package, so each one can be released and tracked on its own.
- e9b915f: Reorganise the workspace so plugin authors have a single dedicated SDK to depend on. No user-visible behaviour change.
- Updated dependencies [db2b076]
- Updated dependencies [986fb74]
- Updated dependencies [fc371c1]
- Updated dependencies [6cc984c]
- Updated dependencies [6cc984c]
- Updated dependencies [3743af3]
- Updated dependencies [6cc984c]
- Updated dependencies [e9b915f]
- Updated dependencies [b55a04b]
- Updated dependencies [e9b915f]
- Updated dependencies [e340f9d]
- Updated dependencies [db2b076]
- Updated dependencies [e92154f]
  - @nama/shared@0.1.1
  - @nama/plugin-sdk@0.2.0
  - @nama/plugin-tmdb@0.2.0
  - @nama/plugin-discord@0.2.0
  - @nama/plugin-ntfy@0.2.0
  - @nama/plugin-inbox@0.2.0
  - @nama/plugin-telegram@0.2.0
  - @nama/plugin-jellyfin@0.2.0
  - @nama/plugin-plex@0.2.0
  - @nama/plugin-seerr@0.2.0
  - @nama/plugin-trakt@0.2.0
  - @nama/plugin-tvdb@0.2.0

## 0.1.0

### Minor Changes

- b84b559: Add required `APP_EXTERNAL_URL` env var and expose it as `ctx.appBaseUrl` on `PluginContext` so plugins can build OAuth redirect URIs and outward-facing deep links (e.g. `playerLink`, `webLink`).
- c9e4655: Add GET /api/config/public endpoint and EMAIL_PROVIDER_CONFIGURED env var for email-gated UI flows.
- 8df8c3d: Add Cloudflare Workers entry point and deployment support:

  - New `packages/server/src/worker.ts` Workers-compatible composition (excludes `serveStatic`, the croner scheduler, and the startup migration runner).
  - `db/client.ts` now recognises hosted libSQL (Turso) URLs, skips `mkdirSync` for non-local URLs, and forwards `LIBSQL_AUTH_TOKEN` to `createClient`.
  - `env.ts` accepts the new optional `LIBSQL_AUTH_TOKEN` variable.
  - `index.ts` (self-hosted / Docker entry) now runs pending migrations at startup before the HTTP server accepts traffic.

- 598fa7f: Teach the dispatcher and cache about mixed-scope capabilities, unblocking user-scoped `idResolve@v1` providers (Plex, Jellyfin). `CapabilityDefinition` now declares `scope: "user" | "global" | "mixed"` instead of `userScoped: boolean`; mixed-scope capabilities carry a `scopeForInput(input)` classifier that the dispatcher calls once per request. The resolved scope is threaded through both `capabilityRegistry.listProviders(...)` and the cache key so provider selection and cache-keying agree — a server-local resolution (`plex:ratingKey`, `jellyfin:itemId`) is routed to user-scoped providers and cached under `user:<userId>`, while cross-service ids (`tmdb`, `imdb`, `tvdb`, `trakt`) continue to route globally and share one cache entry across users. `idResolve@v1` becomes the first mixed-scope capability; Plex and Jellyfin plugins that declared user-scoped `idResolve` providers in earlier PRs are now reachable through the dispatcher without plugin-side changes.
- bde0d39: Move error severity out of individual `captureError` callsites and onto the code itself. The `HOST_ERROR_CODES` registry is now a keyed object of `{ severity }` specs — per-code-object shape is intentional so future metadata (translation hints, default HTTP status, category) can hang off it without a breaking refactor. `captureError` derives the effective severity via `meta.severity ?? severityFor(code)`; explicit severity still wins on recovered paths. Unknown codes default to `error` (over-capture rather than silently drop).

  Adds a third `info` severity level for expected user-input failures — bad URLs, wrong credentials, stale 404s, permission denied. `info` records are stored alongside `error` and `warning` so admins can filter them in when debugging a specific user flow, but the admin viewer's default filter keeps them hidden so the "something is wrong right now" signal is not drowned out. Removes the per-callsite `isUserInputError` gate in `plugin-runtime/runtime.ts` — the registry is now the single source of truth for the error-design-doc rule ("expected user-input failures don't enter the default error view").

- b7bb50a: Extend the plugin capability catalog and built-in plugin coverage.

  New methods on existing capabilities:

  - `watchHistory@v1.removeFromHistory` (Trakt)
  - `ratings@v1.removeRating` (Trakt)
  - `recommendations@v1.getAnticipated` (Trakt)
  - `calendar@v1.getUpcomingMovies` (Trakt)
  - `mediaRequest@v1.cancelRequest` (Seerr)

  New capabilities:

  - `watchProviders@v1` (TMDB) — streaming/rent/buy provider names per region.
  - `trailers@v1` (TMDB) — trailer/teaser/clip videos per media item.
  - `playback@v1` (Trakt) — cross-device resume positions.
  - `collection@v1` (Trakt) — user's owned library, distinct from watchlist.

  Plugins bumped: trakt 1.1.0 → 1.2.0, tmdb 2.0.0 → 2.1.0, seerr 1.2.0 → 1.3.0.

- bde0d39: Route backend-originated validation errors to the specific form input that caused them, instead of only the top-of-modal banner. Reuses the existing `params` slot on `UserFacingError` via a `params.field` convention — any `PluginError` can carry `{ field, value }` params that thread through `runAuth` → `AuthResult.error.params` → `unprocessable(..., { ..., field })` → wire-body `params.field`. The client's new `packages/client/src/lib/errors/form-errors.ts` helper (`splitFormError` + `parseFormErrorResponse`) is reusable from any form surface — given a body and the form's property names it returns `{ message, fieldErrors }` so the caller just assigns into existing state. `allowed-hosts.ts` is the first emitter: a bad URL or blocked hostname now highlights the `externalServerUrl` input directly.
- 45a18f1: Extend `idResolve@v1` to accept the server-local id types `plex:ratingKey` and `jellyfin:itemId` on both input `from` and output bundles so user-scoped media-server plugins (Plex, Jellyfin) can resolve their local ids to cross-service ids on a per-user basis.
- 74a7eaf: Add the Jellyfin built-in plugin covering libraryAvailability, playback, playbackSessions, continueWatching, watchHistory, libraryAdmin, and idResolve capabilities. The plugin authenticates users against Jellyfin's AuthenticateByName endpoint, caches the resolved Jellyfin user id on userConfig, post-filters /Sessions results to the cached user for privacy (with a server-side `controllableByUserId` payload-size hint), and keeps server-to-server fetches on the internal URL while building every player/web link from the external URL. To support server-resolved identifiers during auth, the AuthResult "completed" variant now carries an optional userConfigPatch that the form/redirect/device auth completion paths merge into the stored userConfig; `null` patch values delete the key from the persisted userConfig so plugins can promote submitted secrets into the encrypted credentials blob (Jellyfin moves the user-entered password there and reads it back from `ctx.credentials` on re-auth).
- ec33991: Add `libraryAvailability@v1` and `continueWatching@v1` capability contracts for self-hosted media-server plugins (Plex, Jellyfin). Introduce a shared `LibraryItem` zod schema (`@nama/shared/plugins/library`) reused by both capabilities and earmarked for the upcoming `playbackSessions@v1` / `libraryAdmin@v1` contracts.
- d6c7887: Scaffold /api/me sub-app with GET /role endpoint. First of several user-scoped endpoints for the settings surface.
- 613b278: Add the Plex built-in plugin. Implements `libraryAvailability@v1`,
  `playback@v1`, `playbackSessions@v1`, `continueWatching@v1`, `watchHistory@v1`,
  `libraryAdmin@v1`, and a user-scoped `idResolve@v1` against a user's own Plex
  Media Server. Auth is the PIN flow (`oauth_device`), exchanged against
  `plex.tv/api/v2/pins`; the approved token drives every subsequent call.
  `pollAuth` now also auto-fills `externalServerUrl` from the first public
  server connection in the `/resources` response so users do not have to
  hand-copy the URL after the PIN completes. Connections carry an external URL
  (used for player / web deep links built by the caller's device) and an
  optional internal URL marked `x-private` (used by the host for server-to-server
  fetches). Session output is filtered to the connecting account so a token
  that technically sees other users' sessions never leaks them back. Rate-limit
  handling is unified: a single `throwIfRateLimited` helper signals the
  shared-credentials pool via `ctx.pool.markExhausted` on 429 for every call
  site, including the direct-fetch scrobble / unscrobble / refresh paths.
  `searchLibrary` now respects the caller's `limit` via `X-Plex-Container-Size`
  and `getHistory` builds the `viewedAt>=<unix>` filter manually so
  URLSearchParams does not percent-encode `>` and drop the `since` bound.
  Extends `AuthResult.completed` with an optional `userConfigPatch` so plugins
  that resolve server-side identifiers during auth (Plex `machineIdentifier` +
  account id, Jellyfin `userId`) can write them through without a client
  round-trip.
- c336404: Add admin-only advanced policy for installed plugins: per-plugin host allowlist
  override (intersection with `manifest.allowedHosts`) and encrypted custom headers
  injected into every `ctx.fetch` call. Blocked-host attempts are logged under a
  new `plugin.host_blocked_by_admin` error code. Plugins continue to see the
  existing `plugin.upstream_error` so no plugin changes are required.
- df3624f: Server bundle for the plugin-connections UI revamp (#39 #40 #41 #42 #43): widen the embedded plugin shape on `/api/connections/` to a full `PluginSummary` (renames `auth` → `authKind`, replaces flat `capabilities` with scoped arrays, drops `enabled`, adds `poolable` / `adminSharedAvailable` / `credentialsSchema`); compute `displayFields` server-side from `userConfigSchema` (excludes `x-secret`, redacts `x-private` to `••••`, marks URI / `x-mono` / `x-allowed-host` fields as `mono`); add `sharedCredentialsEnabledCount` and widen `sharedCredentialsCount` to total entries on `/api/plugins/`; rename `auth` → `authKind` on `/api/connections/available`; add `POST /api/plugins/:id/shared-credentials/test-ephemeral` for unsaved-credential probes; and add typed error codes `plugin.credentials_empty`, `plugin.duplicate_label`, `plugin.invalid_base_url` (the latter replacing `plugin.input_invalid` for `x-allowed-host` validation failures) so the frontend can route inline field errors. `listForUser` now hides connections to disabled plugins (matching the design doc's claim) and de-duplicates per-plugin work across rows; `/api/plugins/` derives both shared-credential counts from a single `list()` call.
- bde0d39: Add a new `x-plugin-resolved: true` JSON Schema extension for `userConfigSchema` properties that the plugin owns and the user must never submit. On incoming client payloads, `createFormConnection` and `updateUserConfig` strip these keys _before_ the payload reaches `startAuth` or the persisted row — the plugin repopulates them through `userConfigPatch`. A hostile client cannot impersonate another account by spoofing e.g. Jellyfin's `userId`. The frontend hides `x-plugin-resolved` fields from the create form entirely and renders them disabled on the edit form so users can see what the plugin resolved. Composes with standard JSON Schema `readOnly: true` (display-only hint) — `x-plugin-resolved` adds the server-side stripping on top.

  Applied to Jellyfin's `userId` userConfig field (version bumped to 1.0.1).

- 572e9b5: Add `playbackSessions@v1` and `libraryAdmin@v1` capability contracts. `playbackSessions` exposes `getSessions` / `stopSession` with a `SessionEntry` that nests a `LibraryItem` plus transcoding decisions and state; `libraryAdmin` exposes fire-and-forget `refreshLibrary` / `refreshItem`. Both are `userScoped: true` and reuse the shared `LibraryItem` shape. No MCP tools yet — those land with the Plex and Jellyfin plugin implementations in #22 and #23.
- 64197cc: Wire the Profile, Authorized apps, and Danger zone tabs to real backends and add the supporting endpoints. The server gains `/me/apps` (list + revoke), `/me/export` (versioned ZIP), `/me/delete` (password + email gated, FK cascade), and email-aware Better Auth config that targets the old address for change-email confirmation. The client tabs replace their mocks with real queries/mutations, including a verification banner with 60s resend cooldown and a delete dialog that refuses to submit until both inputs validate.
- 612d9c1: Honor the `x-allowed-host` JSON Schema extension in `ctx.fetch`. Properties marked `"x-allowed-host": true` in a plugin's `userConfigSchema` or `sharedCredentialsSchema` now have their URL hostnames automatically unioned into the per-invocation `ctx.fetch` allowlist, alongside the plugin's static `manifest.allowedHosts`. Self-hosted plugins (Plex, Jellyfin, Sonarr/Radarr, etc.) can now reach arbitrary user-supplied servers without declaring `allowedHosts: ["*"]`. Malformed URLs in `x-allowed-host` fields fail the call with `plugin.input_invalid`.
- 8857738: Implement the `x-private` JSON Schema extension for connection `userConfig`. Properties marked `"x-private": true` are stored plaintext but stripped from every `connection.list` and `connection.getUserConfig` response. Merge-on-update semantics mirror `x-secret` — an omitted `x-private` field on `connection.updateUserConfig` preserves the stored value. A field may carry both `x-secret` and `x-private`; stripping is idempotent and encryption-at-rest still applies via `x-secret`. Needed by plugins like Plex/Jellyfin that track an `internalServerUrl` that must not leak to the browser.

### Patch Changes

- f40d74a: Added comprehensive logging, metrics, and warnings capture to the `feature.preference.rebuild` job handler.
- bb383db: Fix Cloudflare Workers SPA routing so client-side routes (e.g. `/auth/login`) work on direct navigation and page refresh. Adds `not_found_handling = "single-page-application"` to the `[assets]` block in `wrangler.toml`, which makes Cloudflare Assets serve `index.html` with a 200 OK for any path that doesn't match a built asset.
- 21ed4d3: Fix deployed-Worker login failing with `BetterAuthError: Failed to decrypt private key`. The temporary `create-user` script now writes `user` + `account` rows directly via drizzle instead of calling `auth.api.signUpEmail()`, so it no longer boots better-auth, no longer loads the `jwt` plugin, and no longer generates a JWKS keypair encrypted with whatever `BETTER_AUTH_SECRET` the script happened to run with. The `account` row it writes still uses `providerId: "credential"` with an argon2id hash, matching exactly what the runtime sign-in path looks up.
- 9239968: Harden built-in plugin write methods after PR review.

  - Seerr `createRequest` and `cancelRequest` now re-throw host-actionable errors (`plugin.token_expired`, `plugin.bad_credentials`, `plugin.rate_limited`) instead of absorbing them into a graceful `{ ok: false, message }` contract, so the host can trigger token refresh and backoff during writes.
  - Trakt `getHistory`, `getTrending`, and `getPositions` skip rows missing the expected nested media object instead of throwing through a non-null assertion, matching the defensive pattern already in `getAnticipated`.
  - Trakt `parseTraktId` now rejects prefix-matched digits such as `"42abc"`; only pure-digit strings are accepted.

- bde0d39: Fix Jellyfin (and any future form-auth plugin with `x-allowed-host`) rejecting every valid user-supplied server URL with `host not in allowlist`. `runAuth` now threads the submitted `userConfig` into `buildAuxContext` so `x-allowed-host` hostnames are resolved against the form submission when `startAuth` fires, not just during capability invocations with an already-persisted connection. Moves `buildAuxContext` inside the catch boundary so a malformed URL also comes back as a structured auth-result error instead of escaping as an uncaught 500.
- 29ec49e: Add composite (user_id, client_id) indexes on oauth_access_token and oauth_refresh_token for /me/apps aggregation performance.
- 85105df: Add per-plugin contract test files for TMDB, Trakt, TVDB, and Seerr so each built-in plugin has a dedicated test that drives every declared capability method against its Zod output schema — matching the Plex/Jellyfin pattern. Closes the "contract test per built-in plugin" checkbox on the plugin architecture v1 tracking issue.
- Updated dependencies [bde0d39]
- Updated dependencies [ec33991]
- Updated dependencies [c336404]
- Updated dependencies [df3624f]
- Updated dependencies [09f1101]
  - @nama/shared@0.1.0

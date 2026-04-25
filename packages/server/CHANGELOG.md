# @ent-mcp/server

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
- ec33991: Add `libraryAvailability@v1` and `continueWatching@v1` capability contracts for self-hosted media-server plugins (Plex, Jellyfin). Introduce a shared `LibraryItem` zod schema (`@ent-mcp/shared/plugins/library`) reused by both capabilities and earmarked for the upcoming `playbackSessions@v1` / `libraryAdmin@v1` contracts.
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
  - @ent-mcp/shared@0.1.0

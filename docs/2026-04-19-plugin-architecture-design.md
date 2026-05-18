# Plugin Architecture for Connections

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Supersedes:** Initial Connections design (non-plugin)
**Updated:** 2026-04-25 — packaging layout reorganised, see `docs/2026-04-25-plugin-monorepo-design.md` for details. Runtime, capability, & DB designs remain authoritative.
**Updated:** 2026-04-25 — `notificationDelivery@v1` capability & `ctx.notify()` added; see `docs/2026-04-25-notifications-design.md` for full design.

## Summary

Connections subsystem redesigned: every service integration (Trakt, Seerr, TMDB, TVDB, Plex, Jellyfin, future 3rd-party) → plugin. Built-ins ship as bundled plugins in same format as 3rd-party. Capabilities versioned, schema-validated, discoverable at runtime → host fan-out to whichever plugins implement them.

> **v1 scope:** Built-in plugins run as trusted TypeScript modules inside host process — no sandbox boundary. QuickJS WASM sandbox & 3rd-party install/update/rollback → deferred. See §Deferred.

> **Packaging update (2026-04-25):** Each integration → own workspace package under `packages/plugins/<id>/`, depends on `@ent-mcp/plugin-sdk`. Apps → `apps/{client,server}/`. Built-ins load via workspace TypeScript imports (no runtime bundle loading in v1); each plugin builds `dist/plugin.js` bundle for distribution. Versioning independent per package via Changesets. Full design: `docs/2026-04-25-plugin-monorepo-design.md`.

Capabilities declare **scope** — `global` | `user` — so single plugin can expose both server-wide source (TMDB metadata) & per-user integration (TMDB watchlist). Admins configure **admin-owned pool** of shared creds for pool-safe plugins so quota-limited services (TMDB) fail over across multiple keys. Per-plugin `personalKeyFallback` policy optionally links pools for per-user requests without sharing keys across users.

Authoritative spec for backend. Frontend covered in later document.

## Goals

- One abstraction ∀ service integrations. Built-ins & 3rd-party → same interface.
- Plugins extensible feature-by-feature. New capabilities added to host without breaking existing plugins.
- Plugins sandboxed. Can only do what host explicitly grants.
- Typed dev for plugin authors via host-generated `.d.ts`.
- Multi-instance-per-service preserved.
- First-class global-scope (server-wide, admin creds) vs user-scope (per-user auth). Single plugin can expose both.
- Admin creds may pool for pool-safe plugins (multiple TMDB keys) with host-driven rotation & failover.
- V1: user connection ∃ only if it carries real creds. ⊥ empty-creds rows.
- ∀ cred material encrypted at rest (AES-256-GCM). Plaintext `*_config` stays plaintext; `*_credentials` always encrypted.

## Non-goals

- Plugin marketplace | auto-update. Admin installs manually by URL.
- User-installed plugins in v1.
- Cross-plugin event bus. Plugins ⊥ call other plugins.
- Pluggable internals beyond service integration layer.

## Architecture Overview

Three layers:

- **Host** — owns DB, encryption, auth, cron (croner), RPC, plugin runtime. ⊥ trust plugin code.
- **Plugin runtime** — host-owned subsystem. Loads, sandboxes, invokes plugins. Exposes narrow `PluginContext` only.
- **Plugins** — self-contained JS files. Each declares manifest, implements ≥1 capability interfaces, handles own auth.

Central components:

- `MediaService` only surface rest of app uses. RPC procedures & MCP tools ⊥ call plugins directly.
- **Capability registry** (in-memory, rebuilt on install/update/disable) maps `(capability, version, scope)` → list of implementing plugins. Global & user lookups independent.
- `MediaService` dispatches through runtime. Global-scoped calls → pick `shared_credentials` from admin pool (rotate for pool-safe). User-scoped calls → resolve user's connection(s), pick from user pool (per-plugin `poolable` flag). Optional `personalKeyFallback` → exhaustion falls through to other side, strictly within single user request.
- **Connections** bound by `plugin_id` (not hardcoded service enum); ∃ only for plugins with ≥1 user-scoped capability.

Carried over unchanged:

- AES-256-GCM with per-user derived keys.
- `id_map` table for cross-service ID resolution, populated opportunistically.
- `account:connections` permission, per-user scope (admins ⊥ edit other users' connections).
- Multi-instance per service with default-instance (user-side).
- Connections can be disabled without removal.

Removed:

- `service` enum (`"trakt" | "tmdb" | "seerr" | "tvdb"`) on `service_connections`. Replaced by `plugin_id`.
- `integrations/` folder. Each former integration → bundled plugin.
- Ad-hoc `allowsSharedCredentials` flag & bespoke "Shared-key model". Folded into general scope + pool model.

## Plugin Manifest

Every plugin exports `getManifest()` → this shape. Validated against host-side Zod schema at install.

```ts
interface PluginManifest {
  // Identity
  id: string; // e.g. "trakt"
  name: string; // display name
  version: string; // semver
  description: string;
  logoUrl?: string;
  author: { name: string; url?: string };
  homepage?: string;

  // Host compatibility
  sdkVersion: string; // semver range; mismatch fails install

  // Network allowlist (enforced by ctx.fetch)
  allowedHosts: string[];

  // Four config shapes — one per storage slot. *_Config is plaintext;
  // *_Credentials is encrypted at rest.
  globalConfigSchema?: JSONSchema; // admin plaintext (plugins.global_config)
  sharedCredentialsSchema?: JSONSchema; // admin secrets — one schema, many pool entries
  userConfigSchema?: JSONSchema; // user plaintext (service_connections.user_config)
  credentialsSchema?: JSONSchema; // user secrets (service_connections.encrypted_credentials)

  // Auth ceremony (applies to user-scoped capabilities only)
  auth: { kind: "form" | "oauth_redirect" | "oauth_device" | "none" };

  // Capabilities implemented. Each entry declares its version and scope.
  // Capability-specific extra fields are permitted alongside `version` and
  // `scope` — for example `notificationDelivery@v1` requires
  // `supportsKinds: NotificationContentKind[]`. Extra fields are validated by
  // the per-capability schema at install time, not by the manifest schema.
  capabilities: Record<
    string,
    {
      version: string; // e.g. "v1"
      scope: "global" | "user";
      [extra: string]: unknown;
    }
  >;

  // Pool-safety opt-in. When true, admin may configure multiple shared_credentials
  // entries and the host will rotate/fail-over transparently. When false or unset,
  // admin has a single shared_credentials slot.
  poolable?: boolean; // default false

  // Scheduled jobs
  jobs?: Array<{
    id: string;
    schedule: string; // cron expression
    handler: string; // exported handler name
    perConnection?: boolean; // if true, host iterates all connections
  }>;
}
```

**Why JSON Schema not Zod for config shapes.** JSON Schema → inert data, renders on frontend via generic renderer (e.g. `@rjsf/core`), validates server-side with `ajv`. Only viable choice once 3rd-party plugins run in QuickJS sandbox where bundling Zod = overkill. Host's internal schemas stay Zod.

**`x-secret` extension.** Properties marked `"x-secret": true` → treated as secrets by host & frontend. Frontend renders as masked inputs, ⊥ display values on connection cards. Host strips from `connection.list` & `connection.getUserConfig` responses. On `updateUserConfig`, omitted secret fields preserved by merging with prior stored value. `sharedCredentialsSchema` implicitly secret — host ⊥ return decrypted values.

**`x-private` extension.** Properties marked `"x-private": true` → stored plaintext but stripped from every API response. Protects operationally-sensitive-but-non-secret values (private-network server URL) without encryption cost of `x-secret`. Read-side mirrors `x-secret`: omitted fields on `updateUserConfig` preserved by merge. Field may carry both `x-secret` & `x-private` → encrypted at rest AND stripped.

**`x-allowed-host` extension.** Properties marked `"x-allowed-host": true` in `userConfigSchema` | `sharedCredentialsSchema` | `globalConfigSchema` → URL-valued fields whose hostname added to per-call `ctx.fetch` allowlist, unioned with static `manifest.allowedHosts`. Enables self-hosted services (Plex, Jellyfin) with user-supplied URLs unpredictable at manifest time, and admin-set single-instance plugins (Seerr) whose baseUrl lives on `globalConfig`. Host resolves dynamic host set every invocation: user-scoped reads active connection's `userConfig`; admin-scoped reads picked `shared_credentials` entry; `globalConfigSchema` hosts unioned in regardless of pick side. Malformed URL in `x-allowed-host` field → `plugin.invalid_base_url`; allowlist ⊥ silently degrade.

**`x-plugin-resolved` extension.** Properties marked `"x-plugin-resolved": true` in `userConfigSchema` → values plugin sets, ⊥ user. On `createFormConnection` & `updateUserConfig`, host strips these keys from client payload before reaching `startAuth` or persisted row; plugin repopulates via `userConfigPatch` (e.g. Jellyfin resolves `userId` from `/Users/Me`). Hostile client ⊥ impersonate another account by spoofing value. Frontend hides `x-plugin-resolved` fields from create form, renders disabled on edit form. Complements `readOnly: true` (`readOnly` = frontend-only hint; `x-plugin-resolved` adds server-side stripping). Plugins needing both → set both.

**`sdkVersion` = hard compatibility gate.** Install fails fast with clear error on mismatch.

### Derived Validation Rules

Applied at manifest install:

| Plugin shape              | `auth.kind` (user ceremony) | `sharedCredentialsSchema`          | `credentialsSchema` | `userConfigSchema` | `poolable` allowed |
| ------------------------- | --------------------------- | ---------------------------------- | ------------------- | ------------------ | ------------------ |
| All capabilities `global` | must be `"none"`            | typically required (e.g. API key)  | must be **absent**  | must be **absent** | yes                |
| Any capability `user`     | must not be `"none"`        | optional (e.g. OAuth client creds) | **required**        | optional           | yes                |
| Mixed (both scopes)       | must not be `"none"`        | typically required                 | **required**        | optional           | yes                |

Scope change between versions (global → user on capability) = breaking change; host rejects minor/patch bumps that alter scope.

### Concrete Plugin Mappings

```ts
// TMDB — pure-global, poolable
globalConfigSchema:      { imageBaseUrl }                // plaintext
sharedCredentialsSchema: { apiKey }                      // encrypted admin pool
userConfigSchema:        (none)
credentialsSchema:       (none)
auth: { kind: "none" }
poolable: true
capabilities: {
  metadata:        { version: "v1", scope: "global" },
  idResolve:       { version: "v1", scope: "global" },
  watchProviders:  { version: "v1", scope: "global" },
  trailers:        { version: "v1", scope: "global" },
}
// A future TMDB revision may add user-scoped watchlist/ratings; that would
// promote the plugin to "mixed" shape (credentialsSchema required,
// auth.kind: "oauth_redirect") and constitutes a major version bump.

// Trakt — mostly user-scoped, not poolable (each connection is a distinct account)
auth: { kind: "oauth_device" }
poolable: false
capabilities: {
  watchHistory:    { version: "v1", scope: "user"   },
  watchlist:       { version: "v1", scope: "user"   },
  ratings:         { version: "v1", scope: "user"   },
  recommendations: { version: "v1", scope: "user"   },
  calendar:        { version: "v1", scope: "user"   },
  userComments:    { version: "v1", scope: "user"   },
  playback:        { version: "v1", scope: "user"   },
  collection:      { version: "v1", scope: "user"   },
  idResolve:       { version: "v1", scope: "global" },
}

// Seerr — all user-scoped, not poolable (each connection is a distinct server)
auth: { kind: "form" }
poolable: false
capabilities: {
  mediaRequest: { version: "v1", scope: "user" },
}

// TVDB — pure-global, poolable (id resolver only in v1)
auth: { kind: "none" }
poolable: true
capabilities: {
  idResolve: { version: "v1", scope: "global" },
}

// Plex — self-hosted media server, user-scoped, not poolable.
// Each connection is a distinct Plex account linked to one or more servers the
// account has access to. Auth uses Plex's PIN flow, which maps cleanly onto
// oauth_device: the plugin returns a short code, the user visits plex.tv/link
// to approve it, and the host polls until the token is issued.
auth: { kind: "oauth_device" }
poolable: false
capabilities: {
  libraryAvailability: { version: "v1", scope: "user" },
  playback:            { version: "v1", scope: "user" },
  playbackSessions:    { version: "v1", scope: "user" },
  continueWatching:    { version: "v1", scope: "user" },
  watchHistory:        { version: "v1", scope: "user" },
  libraryAdmin:        { version: "v1", scope: "user" },
  idResolve:           { version: "v1", scope: "user" }, // for plex:ratingKey ↔ tmdb/imdb handles
}
// userConfig carries:
//   - machineIdentifier:     chosen from the list returned by
//                            plex.tv/api/v2/resources after auth.
//   - externalServerUrl:     public URL the user's browser can reach (used for
//                            playerLink / webLink). Required.
//   - internalServerUrl?:    private URL the host uses for server-to-server
//                            fetches when set (e.g. http://plex:32400 inside a
//                            docker network). Optional; falls back to
//                            externalServerUrl. Never surfaced to the client.
// See "Self-hosted network topology" for the two-URL rationale.

// Jellyfin — self-hosted media server, user-scoped, not poolable.
// Each connection is a distinct (serverUrl, username) pair, so admins running
// a shared family Jellyfin still get one row per user.
auth: { kind: "form" }
poolable: false
capabilities: {
  libraryAvailability: { version: "v1", scope: "user" },
  playback:            { version: "v1", scope: "user" },
  playbackSessions:    { version: "v1", scope: "user" },
  continueWatching:    { version: "v1", scope: "user" },
  watchHistory:        { version: "v1", scope: "user" },
  libraryAdmin:        { version: "v1", scope: "user" },
  idResolve:           { version: "v1", scope: "user" }, // for jellyfin:itemId ↔ tmdb/imdb handles
}
// userConfig:
//   - externalServerUrl:   public URL (used for playerLink / webLink). Required.
//   - internalServerUrl?:  private URL used for host-side fetches when set.
//                          Optional; falls back to externalServerUrl.
//   - username
//   - userId:              Jellyfin user id, resolved and cached by startAuth via
//                          /Users/Me. Non-secret, non-editable — stored so every
//                          subsequent capability invocation can build per-user
//                          URLs (/Users/{userId}/...) without a round-trip.
// credentials: { accessToken } — obtained by POST /Users/AuthenticateByName
//                                during startAuth (against internalServerUrl
//                                when set, otherwise externalServerUrl), or
//                                admin-provided API key.
// See "Self-hosted network topology" for the two-URL rationale.
```

## Plugin Entry Point

Single JS file exporting default object built with `definePlugin` (pure identity helper for type inference).

```ts
export default definePlugin({
  manifest: { /* as above */ },

  // Reserved plugin-level methods
  startAuth:      async (ctx, input) => { /* ... */ },
  pollAuth?:      async (ctx, pollState) => { /* oauth_device */ },
  completeAuth?:  async (ctx, queryParams, state) => { /* oauth_redirect */ },
  refreshAuth?:   async (ctx, credentials) => { /* token-expiring services */ },
  testConnection: async (ctx) => { /* cheap API call to verify creds */ },

  // Capability implementations (keys must match manifest.capabilities).
  // Scope is declared in the manifest; the implementation is the same either way —
  // the host injects user fields in ctx only for user-scoped invocations.
  capabilities: {
    watchHistory: {
      getHistory:    async (ctx, opts) => { /* ... */ },
      addToHistory:  async (ctx, items) => { /* ... */ },
    },
    // ...
  },

  // Job handlers (keys must match manifest.jobs[].handler)
  jobs: {
    refreshTokens: async (ctx) => { /* ... */ },
  },
});
```

`testConnection(ctx)` ! for `auth.kind !== "none"`. Called by UI "test" button, health-check cron, & pre-commit during `connection.updateUserConfig`. Pure-global plugins (`auth.kind === "none"`, ∀ capabilities `scope: "global"`) → admin verifies via `plugin.testSharedCredential` (see §API). User-scoped `auth.kind === "none"` plugins (notification channels) → capability owns the probe (e.g. `notificationDelivery.testDelivery`); `testConnection` is optional & may be omitted.

## Auth Ceremony — Flow Types

Host orchestrates auth by `manifest.auth.kind`. Plugin functions return discriminated-union status payloads; host drives UI.

∀ `status: "completed"` payload shape: `{ status: "completed", credentials, userConfigPatch? }`. Optional `userConfigPatch` merges into submitted `userConfig` before `service_connections` row written — for plugins that resolve server-side identifiers during auth (e.g. Jellyfin `userId` from `/Users/Me`) without client round-trip. Keys in `userConfigPatch` ! declared on `userConfigSchema`; host validates merged result & rejects any key plugin attempts to smuggle.

**`form`** (e.g. Seerr):

1. Frontend collects `userConfig` fields from `userConfigSchema`.
2. Host calls `startAuth(ctx, userConfig)`. Plugin tests creds → `{ status: "completed", credentials, userConfigPatch? }`.

**`oauth_redirect`** (standard OAuth2):

1. Host calls `startAuth(ctx, null)`. Plugin → `{ status: "redirect", url, state }`.
2. Host stashes `state` in `pending_auth` row keyed by nonce.
3. Frontend redirects user.
4. Provider redirects back to host callback. Host looks up `state`, calls `completeAuth(ctx, queryParams, state)` → `{ status: "completed", credentials, userConfigPatch? }`.

**`oauth_device`** (e.g. Trakt):

1. Host calls `startAuth(ctx, null)`. Plugin → `{ status: "display_code", code, verifyUrl, pollState, intervalSec }`.
2. Host returns code + verifyUrl + nonce + intervalSec to frontend.
3. Frontend displays instructions, polls `connection.pollDeviceAuth(nonce)` at `intervalSec`.
4. Each poll: host calls `pollAuth(ctx, pollState)`. Plugin → `pending` | `completed` (with optional `userConfigPatch`) | `error`.

**`none`**: plugin has no per-user creds + no auth ceremony. Two valid shapes:

1. **Pure-global** (∀ capabilities `scope: "global"`, e.g. TMDB/TVDB) → ⊥ `service_connections` rows; admin-managed via shared credentials only.
2. **User-scoped with self-contained `userConfig`** (notification delivery plugins like Telegram, Discord, ntfy, inbox) → connection-row is the channel. `userConfig` carries everything the plugin needs (bot token, webhook URL, etc.); no separate `credentials` blob. Host **skips `startAuth`** (plugin exports none) & writes the row directly. Upstream reachability validated lazily via the capability's own test method (e.g. `notificationDelivery.testDelivery`), not at create time.

On `status: "completed"` (auth kinds other than `none`): host merges `userConfigPatch` (if any) into submitted `userConfig`, validates merged result against `userConfigSchema`, encrypts creds, creates `service_connections` row, auto-promotes to default if first instance, returns connection to frontend. **Empty-creds rows rejected**: if validated credentials payload for plugin with `credentialsSchema` missing required fields | resolves to empty object → create refused with typed error. ⊥ "parked" connections. Exception: `auth.kind: "none"` user-scoped plugins persist with `credentials: {}` by design — `writeConnection({ allowEmptyCredentials: true })`.

Creds & device codes ⊥ logged. `pending_auth` rows have 15-min TTL with nightly sweep.

## Capability Interfaces

Typed contract between host & plugin. Host defines as Zod schemas; build script generates `.d.ts` committed to repo. Plugin authors import generated types for dev-time safety.

Example host-side definition:

```ts
export const WatchHistoryV1 = defineCapability({
  id: "watchHistory",
  version: "v1",
  methods: {
    getHistory: {
      input: z.object({ limit: z.number().optional(), since: z.string().optional() }),
      output: z.array(MediaItemSchema),
    },
    addToHistory: {
      input: z.array(MediaItemSchema),
      output: z.object({ added: z.number() }),
    },
  },
});
```

Runtime enforcement on every invocation:

- Validate input against capability's Zod input schema before calling plugin.
- Validate output against Zod output schema after call. Bad output throws before reaching `MediaService`.
- Version pinning. Caller asking `watchHistory@v1` ≠ matched by plugin declaring `watchHistory: "v2"`.
- Scope routing. Registry indexed by `(capability_id, version, scope)`. Capabilities with fixed scope (`scope: "global"` | `scope: "user"`) always land on that pool. Capabilities needing both (today: `idResolve@v1`) declare `scope: "mixed"` on host definition with pure `scopeForInput(input)` classifier. Dispatcher calls classifier once per request → threads resolved scope through both provider lookup & cache key. User-scoped resolution (e.g. `from: "plex:ratingKey"`) → only user-scoped providers, cached under `user:{user_id}`. Global resolution (e.g. `from: "tmdb"`) → only global providers, cached globally. ⊥ server-local handle leaks across users through shared cache entry.

**Versioning policy.** Breaking changes introduce new version alongside old. Old plugins work until no consumer needs v1 → v1 removable host-side. ⊥ forced upgrades. Scope changes (global ↔ user) always = breaking → new major version.

**Initial capability set (canonical scope; plugins may declare opposite where it makes sense):**

- `metadata@v1` — search, get by id, similar, discover, trending. Typically `global`.
- `watchHistory@v1` — get/add/remove history. Output: `watchedAt`, optional `progress`, optional `rewatchCount`. Typically `user`.
- `watchlist@v1` — get/add/remove watchlist. Typically `user`.
- `ratings@v1` — get/set/remove ratings. Typically `user`.
- `recommendations@v1` — personal recommendations, trending, anticipated. Typically `user` (may accept `global` variant for anonymous trending).
- `calendar@v1` — upcoming TV episodes & movie releases. Typically `user`.
- `mediaRequest@v1` — request media, check availability, cancel. Typically `user`.
- `idResolve@v1` — resolve one id type to others; feeds `id_map`. Host-side: canonical **mixed-scope** capability. Metadata providers (TMDB, TVDB, Trakt) register `scope: "global"` for cross-service ids; media-server plugins (Plex, Jellyfin) register `scope: "user"` for server-local handles (`plex:ratingKey`, `jellyfin:itemId`). Host `CapabilityDefinition` declares `scope: "mixed"` with `scopeForInput` classifier. Server-local handles = per-server & per-account → ⊥ global.
- `userComments@v1` — get user's own comments. Typically `user`.
- `watchProviders@v1` — streaming/rent/buy availability per item per region. Typically `global`.
- `trailers@v1` — trailer/teaser/clip videos per item. Typically `global`.
- `playback@v1` — cross-device resume positions. Typically `user`.
- `collection@v1` — user's owned/collected library. Typically `user`.
- `libraryAvailability@v1` — check media item ∃ on connected server (Plex, Jellyfin), with quality details & deep-play link. Typically `user`. Distinct from `collection@v1` (user-curated "I marked this owned" vs ground-truth file presence).
- `playbackSessions@v1` — currently-playing sessions across user's server: device, user, item, progress, transcoding state + stop action. Typically `user`. Distinct from `playback@v1` (historical resume points).
- `continueWatching@v1` — server-computed "pick up where you left off" feed with Next Up episode stitching. Typically `user`. Distinct from `playback@v1` (raw positions) — server's own ranking with Next Up logic already joined.
- `libraryAdmin@v1` — trigger library scan / metadata refresh on demand. Typically `user`, but called by host after `mediaRequest@v1` fulfils so new file lands immediately. App-layer auth may restrict to admins.
- `notificationDelivery@v1` — send notification to 3rd-party service (ntfy, Telegram, Discord) | built-in in-app inbox. Typically `user`. Extra manifest field `supportsKinds: NotificationContentKind[]` so host knows if plugin can render images, markdown, inline actions. See `docs/2026-04-25-notifications-design.md`.
- `artwork@v1` — HD posters, backdrops, clear logos, thumbs per item. Typically `global`. Aggregate per-kind merge across providers w/ `providerPriority` (lower = higher). Extra manifest fields `supportedIdTypes: { movie, tv }` (which id types each provider can serve) + `providerPriority`. Strategy = `aggregate_per_kind` (new variant). See `docs/2026-04-26-plugin-fanart-design.md`.

**Capability discipline.** Plugin declaring capability ! implement every method — loader rejects plugins with missing implementations. Service not natively supporting method → (a) don't declare that capability, or (b) degrade gracefully (empty array | `{ ok: false }`). ⊥ silent ignore. Routing matrix boolean — callers assume "plugin claims watchHistory" ≡ every watchHistory method works.

### Capability Method Reference

**`metadata@v1`** (global)

- `search({ query, type?, limit? })` → `Array<{ item, score? }>`
- `getDetails({ id, type })` → `MediaItem`
- `getSimilar({ id, type })` → `MediaItem[]`
- `getTrending({ type?, limit? })` → `MediaItem[]`
- `discover({ genres?, yearMin?, yearMax?, ratingMin?, limit? })` → `MediaItem[]`
- _added_ `getShowSeasons({ id })` → `{ seasons: SeasonInfo[] }` — canonical season + episode list for a TV title. Backed by TMDB `/tv/{id}` w/ `append_to_response=season/1,season/2,…`. `SeasonInfo = { seasonNumber, name, airDate?, totalEpisodes, episodes: [{ episodeNumber, title, airDate?, runtime? }] }`. Movie titles → caller skips this method (no shape for movies). Specials are `seasonNumber: 0`; UI filters server-side based on availability join.

**`watchHistory@v1`** (user)

- `getHistory({ limit?, since? })` → `HistoryEntry[]`
- `addToHistory(items)` → `{ added }`
- _added_ `removeFromHistory(items)` → `{ removed }` — closes symmetry gap with `addToHistory`. Backed by Trakt `POST /sync/history/remove`.

_Media-server backings (added this revision):_ Plex `GET /:/scrobble` + `GET /:/unscrobble` + `GET /status/sessions/history/all`, Jellyfin `POST /Users/{userId}/PlayedItems/{itemId}` + `DELETE /Users/{userId}/PlayedItems/{itemId}`. Both operate on server-local handles (`plex:ratingKey`, `jellyfin:itemId`) → `addToHistory` / `removeFromHistory` call plugin's own `idResolve@v1` first to translate.

**`watchlist@v1`** (user)

- `getWatchlist({ type? })` → `WatchlistEntry[]`
- `addToWatchlist(items)` → `{ added }`
- `removeFromWatchlist(items)` → `{ removed }`

**`ratings@v1`** (user)

- `getRatings({ type? })` → `RatingEntry[]`
- `setRating({ item, rating })` → `{ ok }`
- _added_ `removeRating({ item })` → `{ ok }` — backed by Trakt `POST /sync/ratings/remove`.

**`recommendations@v1`** (user)

- `getRecommendations({ type?, limit? })` → `MediaItem[]`
- `getTrending({ type?, limit? })` → `MediaItem[]`
- _added_ `getAnticipated({ type?, limit? })` → `MediaItem[]` — distinct from trending (future vs now). Backed by Trakt `/movies/anticipated`, `/shows/anticipated`.

**`calendar@v1`** (user)

- `getUpcoming({ days? })` → `UpcomingEntry[]` — TV episodes.
- _added_ `getUpcomingMovies({ days? })` → `UpcomingEntry[]` — movie releases. Backed by Trakt `/calendars/my/movies/{start}/{days}`. `season`/`episode` unset.

**`mediaRequest@v1`** (user)

- `checkAvailability({ tmdbId, type })` → `{ status }`
- `createRequest({ tmdbId, type, seasons? })` → `{ success, requestId?, message? }`
- `listRequests({})` → `RequestRow[]`
- _added_ `cancelRequest({ requestId })` → `{ ok }` — backed by Seerr `DELETE /request/:id`.

**`idResolve@v1`** (mixed — see §idResolve below for mixed-scope routing rules)

- `resolve({ from, id, type })` → partial id bundle.

**`artwork@v1`** (global, _new_)

- `getArtwork({ ids: { tmdb?, imdb?, tvdb? }, type, languages? })` → `ArtworkBundle` — `{ poster, backdrop, clearLogo, thumb }` each ranked `ArtworkVariant[]` (≤5 per kind) sorted by language preference then likes. Default `languages: ["en", "00"]`. Aggregate-strategy `aggregate_per_kind` merges per-kind across providers in priority order; first non-empty wins per kind. See `docs/2026-04-26-plugin-fanart-design.md`.

**`userComments@v1`** (user)

- `getComments({ limit? })` → `CommentEntry[]`

**`watchProviders@v1`** (global, _new_)

- `getProviders({ id, type, region? })` → `{ streaming: string[], rent: string[], buy: string[] }` — provider names. `region` defaults to host configured region (fallback `"US"`). Backed by TMDB `/{type}/{id}/watch/providers`. Feeds `streaming` field on `ent_details` MCP tool.

**`trailers@v1`** (global, _new_)

- `getVideos({ id, type })` → `Array<{ kind: "trailer" | "teaser" | "clip" | "featurette" | "other", site, key, url, official? }>`. Backed by TMDB `/{type}/{id}/videos`. Feeds `trailer` field on `ent_details` MCP tool.

**`playback@v1`** (user, _new_)

- `getPositions({ type? })` → `Array<{ item, progress (0–100), pausedAt, season?, episode?, playbackId }>`
- `removePosition({ playbackId })` → `{ ok }`

Backed by Trakt `/sync/playback` & `DELETE /sync/playback/:id`. Feeds `watch_progress` on `ent_details` MCP tool.

**`collection@v1`** (user, _new_)

- `getCollection({ type? })` → `Array<{ item, addedAt }>`
- `addToCollection(items)` → `{ added }`
- `removeFromCollection(items)` → `{ removed }`

Backed by Trakt `/sync/collection/*`. "Does user already own this locally" — distinct from `watchHistory` (seen), `watchlist` (planned), `mediaRequest` (asked download manager).

**`libraryAvailability@v1`** (user, _new_)

- `checkAvailability({ id, idType, type })` → `{ items: LibraryItem[] }` — `idType` ∈ `"tmdb" | "imdb" | "tvdb"`. Server-local ids ∉ accepted here: if caller already has server-local id, they have `LibraryItem` & ⊥ need re-check. Returns 0..n matches so multiple quality copies each surface as own entry. Backed by Plex `/library/metadata/matches` / `/library/all?guid=...` & Jellyfin `/Users/{userId}/Items?AnyProviderIdEquals=...`.
- `listRecentlyAdded({ type?, limit? })` → `LibraryItem[]` — server-reported recently-imported items. Backed by Plex `/library/recentlyAdded` & Jellyfin `/Users/{userId}/Items/Latest`.
- `searchLibrary({ query, type? })` → `LibraryItem[]` — free-text search scoped to user's library.
- _added_ `listShowEpisodes({ id, idType })` → `{ episodes: Array<{ season: number, episode: number }> }` — flat list of episodes the user's server has for given show. Caller (host) buckets by `season` to assemble per-server presence. Backed by Plex `/library/metadata/{ratingKey}/allLeaves` & Jellyfin `/Shows/{id}/Episodes`. Plugin = pure pass-through; no bucketing logic plugin-side. Cross-server `idType` (`tmdb`/`imdb`/`tvdb`) → plugin first resolves via own `idResolve@v1` to server-local id, then enumerates. Empty list when title ∉ on this server (⊥ throw).

Where `LibraryItem`:

```
{
  id:            string,   // server-local id (for subsequent server calls)
  title:         string,
  type:          "movie" | "show" | "episode",
  season?:       number,
  episode?:      number,
  quality: {
    resolution?: "4k" | "1080p" | "720p" | "sd",
    codec?:      string,   // e.g. "h265", "h264", "av1"
    hdr?:        "hdr10" | "dolby-vision" | "hlg" | "none",
    bitrate?:    number,   // kbps
  },
  playerLink:    string,   // deep link that opens the native client on the caller's device (plex://..., jellyfin://...). MUST be built from the connection's external server URL, never the internal/docker one.
  webLink?:      string,   // https link to the server's web UI. Same rule — always external.
  sizeBytes?:    number,
  durationSec?:  number,
  addedAt:       string,   // iso timestamp the server imported the item
}
```

Feeds `available_on` on `ent_details` MCP tool, replaces ad-hoc "do I own this" checks, gives frontend one-click "play in Plex / Jellyfin" on media cards.

**`playbackSessions@v1`** (user, _new_)

- `getSessions()` → `SessionEntry[]` — currently-playing sessions visible to authenticated connection. Backed by Plex `/status/sessions` (joined with `/transcode/sessions` for transcoding fields) & Jellyfin `/Sessions`. Results filtered to connection's own user: Jellyfin `/Sessions` returns server-wide sessions for admin tokens → plugin ! post-filter by cached `userConfig.userId`. Plex already account-scoped but plugin still drops sessions whose `User.id` ≠ connection's account id. Privacy guarantee, ⊥ optimisation — ⊥ return another user's session even if underlying token can see it.
- `stopSession({ sessionId, reason? })` → `{ ok, semantics: "forced" | "requested" }` — ask server to end session. Backed by Plex `DELETE /status/sessions/terminate?sessionId=...` & Jellyfin `POST /Sessions/{id}/Playing/Stop`. Plex terminates server-side (session vanishes from next `getSessions()`); Jellyfin sends remote-control command to client (offline/unresponsive client may ignore). `semantics: "forced"` for Plex, `"requested"` for Jellyfin → UI surfaces right confirmation.

Where `SessionEntry`:

```
{
  sessionId:       string,
  deviceName:      string,
  clientName?:     string,              // "Plex for iOS", "Jellyfin Web", ...
  user: { id, name },                   // server-local; same user the connection is authed as, or another home/managed user
  item:            LibraryItem,         // same shape as libraryAvailability returns
  progressMs:      number,
  durationMs:      number,
  state:           "playing" | "paused" | "buffering",
  transcoding?: {
    videoDecision: "direct-play" | "copy" | "transcode",
    audioDecision: "direct-play" | "copy" | "transcode",
    targetBitrate?: number,             // kbps
    reason?:       string,              // server-reported reason, when available
  },
  startedAt:       string,              // iso
}
```

Feeds "playing now on your server" home-feed row & per-device kill switch. Transcoding fields → UI surface "your phone pulling 12 Mbps transcode" without separate capability.

**`continueWatching@v1`** (user, _new_)

- `getContinueWatching({ type?, limit? })` → `ContinueEntry[]` — server's own ranking of what to resume | start next. Backed by Plex `/hubs/continueWatching` (fallback `/library/onDeck` for older servers) & Jellyfin `/Users/{userId}/Items/Resume` merged with `/Shows/NextUp`.

Where `ContinueEntry`:

```
{
  item:      LibraryItem,    // the thing to resume or start (episode for shows, movie for movies)
  progressMs?: number,       // undefined when this is a "start next episode" entry with no prior position
  nextUp?:   LibraryItem,    // for TV: the episode after `item`, when the server surfaces one
  lastPlayedAt?: string,     // iso, for sorting alongside other feeds
}
```

Reuses `LibraryItem` — no re-definition. Distinct from `playback@v1.getPositions` (raw resume points from sync APIs vs curated feed).

**`libraryAdmin@v1`** (user, _new_)

- `refreshLibrary({ librarySectionId? })` → `{ ok }` — trigger full | section-scoped rescan. Fire-and-forget: Plex `/library/sections/{id}/refresh` & Jellyfin `POST /Library/Refresh` return empty bodies. ⊥ expect poll for completion — contract = "server accepted rescan request" only.
- `refreshItem({ serverItemId })` → `{ ok }` — targeted metadata refresh for single item. Backed by Plex `PUT /library/metadata/{id}/refresh` & Jellyfin `POST /Items/{id}/Refresh`.

Intended caller = host, invoked on `mediaRequest@v1` fulfilment completion. Can also surface in admin UI.

**`notificationDelivery@v1`** (user, _new_)

- `deliver({ message, event, channelConfig })` → `{ providerMessageId? }` — render & ship one notification. `message` = host-rendered neutral payload (`title`, `body`, `severity`, `category`, optional `bodyMarkdown`, `image`, `thumbnail`, `actions`, `actionUrl`). `event` = raw typed `NotificationEvent` for plugins wanting specialised rendering. `channelConfig` = plugin's decrypted `userConfig`. Throw `pluginError(..., { retryable })` to drive host's retry/backoff; non-retryable errors mark delivery `failed` immediately.
- `testDelivery({ channelConfig })` → `{ ok, message? }` — validate config & reachability without delivering. Backs UI "Test" button & runs once at channel-create.

Extra manifest field: `supportsKinds: NotificationContentKind[]` (subset of `["text", "markdown", "image", "actions"]`). Plugins ignore message fields outside declared kinds; host always populates core text fields so even `["text"]` plugin has something to send. Channel config schema reuses existing `userConfigSchema`.

**`idResolve@v1`** — additional id-types for media servers

New server-local id-types:

- `plex:ratingKey` — Plex per-server item key. Resolvable to `tmdb` / `imdb` via Plex `Guid` elements. ! for `watchHistory@v1.addToHistory` on Plex.
- `jellyfin:itemId` — Jellyfin per-server item UUID. Resolvable to `tmdb` / `imdb` via `ProviderIds`. ! for `watchHistory@v1.addToHistory` on Jellyfin.

Server-local ids = user-scoped (only meaningful against specific connection) → Plex & Jellyfin implement `idResolve@v1` with `scope: "user"`.

**Host-side mixed-scope routing.** Host `CapabilityDefinition` for `idResolve@v1` declares `scope: "mixed"` with pure `scopeForInput(input) → "global" | "user"` classifier: inputs whose `from` contains `:` (`plex:ratingKey`, `jellyfin:itemId`) → `"user"`, everything else (`tmdb`, `imdb`, `tvdb`, `trakt`) → `"global"`. Classifier invoked once per dispatch; result threaded through both registry lookup & cache key.

V1: provider enumeration & cache-keying ! agree on resolved scope for same request. Disagreement → server-local resolution could write to global cache entry & serve to different user.

**Per-request cache-key scoping.** Cache key prefix carries _resolved_ scope, not capability's declared scope mode. `resolve({ from: "tmdb", id: "550" })` → `mv:idResolve:v1:resolve:global:…` (shared ∀ callers). `resolve({ from: "plex:ratingKey", id: "42" })` for user Alice → `mv:idResolve:v1:resolve:user:alice:…`; for Bob → `mv:idResolve:v1:resolve:user:bob:…` — two distinct entries. Classifier defensively returns `"global"` for malformed inputs.

**`id_map` scoping for server-local handles.** User with two Plex connections → two distinct `plex:ratingKey` values for same title. ∴ `id_map` keys server-local id rows by `(plugin_id, connection_id, id_type, id_value)` rather than `(id_type, id_value)`. Cross-service ids from metadata providers keep connection-less key (shareable across users). Schema change additive — existing columns stay; `plugin_id` & `connection_id` added nullable, constrained non-null for server-local id types.

### Built-in Plugin Coverage

| Capability               | TMDB     | Trakt    | Seerr  | TVDB     | Plex   | Jellyfin | Fanart   |
| ------------------------ | -------- | -------- | ------ | -------- | ------ | -------- | -------- |
| `metadata@v1`            | ✓ global |          |        |          |        |          |          |
| `idResolve@v1`           | ✓ global | ✓ global |        | ✓ global | ✓ user | ✓ user   |          |
| `watchHistory@v1`        |          | ✓ user   |        |          | ✓ user | ✓ user   |          |
| `watchlist@v1`           |          | ✓ user   |        |          |        |          |          |
| `ratings@v1`             |          | ✓ user   |        |          |        |          |          |
| `recommendations@v1`     |          | ✓ user   |        |          |        |          |          |
| `calendar@v1`            |          | ✓ user   |        |          |        |          |          |
| `mediaRequest@v1`        |          |          | ✓ user |          |        |          |          |
| `userComments@v1`        |          | ✓ user   |        |          |        |          |          |
| `watchProviders@v1`      | ✓ global |          |        |          |        |          |          |
| `trailers@v1`            | ✓ global |          |        |          |        |          |          |
| `playback@v1`            |          | ✓ user   |        |          | ✓ user | ✓ user   |          |
| `collection@v1`          |          | ✓ user   |        |          |        |          |          |
| `libraryAvailability@v1` |          |          |        |          | ✓ user | ✓ user   |          |
| `playbackSessions@v1`    |          |          |        |          | ✓ user | ✓ user   |          |
| `continueWatching@v1`    |          |          |        |          | ✓ user | ✓ user   |          |
| `libraryAdmin@v1`        |          |          |        |          | ✓ user | ✓ user   |          |
| `artwork@v1`             | ✓ global |          |        |          |        |          | ✓ global |

`notificationDelivery@v1` coverage lives in dedicated notification plugins (`ntfy`, `telegram`, `discord`, built-in `inbox`). Existing media-integration plugins ⊥ implement notification delivery; notification plugins implement only `notificationDelivery@v1`. See `docs/2026-04-25-notifications-design.md`.

## Plugin Context

Only surface plugin can touch outside its own code. Built fresh by host per call. Host selects creds to inject based on capability scope & current pool rotation pick.

```ts
interface PluginContext<TCred, TSharedCred, TUserCfg, TGlobalCfg> {
  // Networking — only way plugins reach the outside world.
  fetch(url: string, init?: RequestInit): Promise<Response>; // enforces manifest.allowedHosts ∪ x-allowed-host hosts + per-plugin rate limit

  // Media-manager's own public URL (APP_EXTERNAL_URL). Used by plugins to build
  // OAuth redirect_uri values and any client-facing link-back. Never the
  // internal/docker URL — always the one a user's browser can reach.
  appBaseUrl: string;

  // Logging — tagged with plugin id, host-controlled level.
  log: { debug: Fn; info: Fn; warn: Fn; error: Fn };

  // Credentials — decrypted by host, injected per call.
  // For user-scoped calls: host picks from the user's connection pool.
  // For global-scoped calls: undefined.
  credentials?: TCred;

  // Admin-owned secrets — decrypted by host, the host's current pick from the admin pool.
  // For global-scoped calls: always populated when any shared_credentials entry is configured.
  // For user-scoped calls: populated when the plugin needs both user creds and admin secrets
  // (e.g. OAuth flows that require client_id alongside the user's access_token).
  sharedCredentials?: TSharedCred;

  // Config — admin plaintext global + user's per-instance plaintext.
  config: { global: TGlobalCfg; user?: TUserCfg };

  // Pool signaling. The plugin uses this to tell the host that the *currently
  // injected* credential (whichever it was — shared or user) is rate-limited or
  // otherwise temporarily unusable. The host updates bookkeeping and rotates on
  // the next retry attempt within the same call's rotation loop.
  pool: {
    markExhausted(opts?: { retryAfterSec?: number }): void;
  };

  // Plugin-scoped KV store (backed by plugin_store table).
  store: {
    get(key: string, opts?: { scope?: "user" | "global" }): Promise<unknown>;
    set(
      key: string,
      value: unknown,
      opts?: { ttlSec?: number; scope?: "user" | "global" },
    ): Promise<void>;
    delete(key: string, opts?: { scope?: "user" | "global" }): Promise<void>;
  };

  // Emit a pre-registered notification event. The discriminated union enforces
  // at the type level that plugins can only emit events declared in
  // `@ent-mcp/shared/notifications`. Plugin-declared event types are deferred.
  // See `docs/2026-04-25-notifications-design.md` for the registry, dispatch
  // pipeline, and audience model.
  notify(event: Omit<NotificationEvent, "id" | "occurredAt">): Promise<void>;
}
```

Plugin ⊥ need to know which side (shared vs user) current cred came from — after `markExhausted`, host knows what to mark & what to try next.

Deliberately ⊥ exposed:

- ⊥ direct DB access.
- ⊥ filesystem.
- ⊥ cross-plugin calls. Host resolves `id_map` lookups.
- ⊥ `setTimeout` / `setInterval`. Scheduling host-driven via manifest jobs.
- ⊥ env vars. ∀ plugin needs ∈ `config` | credential slots.
- ⊥ `eval` | dynamic imports. Bundled JS = everything plugin gets.
- ⊥ visibility into other pool entries. Plugin sees only current pick.

## Plugin Runtime

Host-owned. Nothing else in app touches runtime directly.

**v1 layout (trusted TypeScript modules, no sandbox):**

```
apps/server/src/plugin-runtime/      host-internal subsystems (NOT exported to plugins)
├── runtime.ts       PluginRuntime — lifecycle, invocation
├── context.ts       PluginContext builder (BuildContextArgs, buildContext)
├── loader.ts        registerBuiltin / listBuiltins / getBuiltin
├── registry.ts      Capability dispatch registry
├── host-bridge.ts   ctx.store implementation
├── fetch-policy.ts  ctx.fetch + buildLogger
├── allowed-hosts.ts allowlist resolution
├── admin-policy.ts  admin-set host narrowing
├── shared-credentials.ts / user-pool.ts  pool resolution
└── register-capabilities.ts  imports SDK capability defs and registers them

packages/plugin-sdk/src/             plugin-author API (consumed by apps/server AND every plugin)
├── types.ts         PluginContext, PluginModule, AuthResult, CapabilityImpl, …
├── define.ts        definePlugin, defineCapability, method
├── errors/plugin-error.ts   PluginError class + factory
├── utils/{http-status,credentials}.ts
├── capabilities/    capability schema definitions (WatchHistoryV1 etc.)
├── validate.ts      validatePluginModule
├── version.ts       SDK_VERSION + isSdkCompatible
└── manifest.ts      re-exports pluginManifestSchema from @ent-mcp/shared

packages/plugins/<id>/src/           one workspace package per integration
└── plugin.ts        the plugin module (definePlugin({...}))
```

See `docs/2026-04-25-plugin-monorepo-design.md` for full packaging design & symbol map.

> **Future — QuickJS sandbox:** When 3rd-party plugin support introduced, `sandbox.ts` (QuickJS instance wrapper via `quickjs-emscripten`) & `host-bridge.ts` (implementations of `ctx` methods crossing sandbox boundary) added. Per-instance memory cap (64 MB) & call timeout (30 s via QuickJS interrupt handler) enforced then.

**Instance model (v1):** one module ref per plugin, registered at host startup. User-scoped data passed through `ctx` per call; plugins ! stash user state in module scope.

**Invocation path:**

1. `MediaService` asks registry which plugins implement `(capability, version, scope)`.
2. ∀ matching plugin: runtime validates input against capability's input schema.
3. Host builds cred plan:
   - **Global-scoped:** pick `shared_credentials` from admin pool. `poolable: true` → rotate across enabled entries where `retry_after` past (round-robin). Non-poolable → use single entry | fail `CAPABILITY_UNAVAILABLE`.
   - **User-scoped:** resolve user's enabled connections. `poolable: true` → rotate; otherwise pick default. `personalKeyFallback` `"admin-first"` | `"personal-first"` → call has secondary pool on other side (always scoped to this user — ⊥ user A key used for user B).
4. Host decrypts selected cred, builds `PluginContext` with `config.global`, `config.user` (user-scoped only), `credentials`, &/or `sharedCredentials` per plan.
5. Host invokes plugin method.
6. If plugin calls `ctx.pool.markExhausted({ retryAfterSec })` & throws: host updates current pool entry `retry_after`, picks next entry (| falls to secondary pool per `personalKeyFallback`), rebuilds `ctx`, retries. Retry count bounded by total pool size; exhausting everything → `POOL_EXHAUSTED`.
7. Runtime validates output against output schema.
8. Result → `MediaService` for fan-out handling.

**`personalKeyFallback` policy (per plugin, admin-configured):**

| Policy             | Primary pool                                                   | Fallback pool                                                                           |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `"off"` (default)  | Context-dependent (admin pool for global, user pool for user)  | None                                                                                    |
| `"admin-first"`    | Admin shared-credentials pool                                  | Requesting user's own connection pool (user-scoped calls only, if user has connections) |
| `"personal-first"` | Requesting user's own connection pool (user-scoped calls only) | Admin shared-credentials pool                                                           |

Only meaningful for plugins with `poolable: true` & ≥1 user-scoped capability. Pure-global plugins → policy unused. Non-poolable plugins with user-scoped capabilities → policy still applies (pool size-one on user side).

**Error handling:**

- Plugin throws: host catches, logs with plugin id & stack, updates connection | pool entry (`status = "error"` on connection | `retry_after` on pool entry), returns typed error. Host ⊥ crash.
- Auth-specific errors (expired token, bad creds) surface via reserved error codes → host triggers refresh | marks connection / shared-credential entry as errored.
- `POOL_EXHAUSTED`: ∀ entries in ∀ relevant pools in cooldown. Carries nearest `retryAfterSec`.
- `CAPABILITY_UNAVAILABLE`: no plugin provides `(capability, scope)` | only providers have no usable config.
- _(Future — QuickJS sandbox)_ Sandbox OOM | timeout: runtime reboots instance on next use; affected connection marked error until recovery.

**Security enforcement points:**

- `ctx.fetch`: hostname check against `manifest.allowedHosts` ∪ hostnames from `x-allowed-host` fields in active `userConfig`/`shared_credentials`/`globalConfig`; per-plugin token-bucket rate limit.
- `ctx.store`: server-side namespacing by `(plugin_id, user_id, key)`. Plugins ⊥ see other plugins' | other users' data.
- `ctx.log`: tagged & filtered by host.
- `ctx.pool.markExhausted` purely advisory to host; ⊥ leak state across plugins | users.
- Call timeout, memory limit, ⊥ dynamic code execution.

**Caching implications:**

- Global-scoped results = user-independent. Cache keys: `plugin:{plugin_id}:{capability}:{argsHash}`, shared ∀ users.
- User-scoped results keep `user:{user_id}:{plugin_id}:{capability}:{argsHash}` keys.

## Database Schema

### `plugins`

Registry of installed plugins. One row per plugin.

```
plugins
├── id                       text PK                           (matches manifest.id)
├── version                  text NOT NULL                     (semver)
├── source_url               text NOT NULL                     (where JS was fetched)
├── source_type              text NOT NULL                     ("builtin" | "url")
├── checksum                 text NOT NULL                     (sha256 of plugin.js)
├── manifest                 text NOT NULL                     (full manifest JSON)
├── enabled                  integer NOT NULL DEFAULT 1
├── global_config            text                              (plaintext JSON, nullable)
├── personal_key_fallback    text NOT NULL DEFAULT 'off'       ('off' | 'admin-first' | 'personal-first')
├── installed_by             text FK → user.id
├── installed_at             integer NOT NULL
├── updated_at               integer NOT NULL
```

`global_config` plaintext by design — display settings, base URLs, feature flags. ∀ admin secrets → `plugin_shared_credentials` (encrypted).

One version per plugin at a time. Retention: last 3 version directories on disk for rollback.

### `plugin_shared_credentials` (new)

Admin-owned encrypted creds for plugin. `poolable: true` → host rotates across enabled entries with cooldown. Non-poolable → exactly one row permitted per plugin (enforced at insert).

```
plugin_shared_credentials
├── id                  text PK
├── plugin_id           text FK → plugins.id, NOT NULL, ON DELETE CASCADE
├── label               text NOT NULL                       (admin-facing name, e.g. "Primary key")
├── encrypted_value     text NOT NULL                       (JSON matching manifest.sharedCredentialsSchema)
├── iv                  text NOT NULL
├── enabled             integer NOT NULL DEFAULT 1
├── last_exhausted_at   integer                             (unix seconds, nullable)
├── retry_after         integer                             (unix seconds, nullable — ready when NULL or past)
├── created_at          integer NOT NULL
├── updated_at          integer NOT NULL
├── INDEX(plugin_id, enabled)
```

Decrypted values ⊥ returned over API. Admin UIs use `label` & status telemetry only.

### `service_connections` (revised)

```
service_connections
├── id                       text PK
├── user_id                  text FK → user.id, NOT NULL
├── plugin_id                text FK → plugins.id, NOT NULL   [replaces service enum]
├── status                   text NOT NULL                    ("connected" | "expired" | "error" | "disconnected")
├── enabled                  integer NOT NULL DEFAULT 1
├── is_default               integer NOT NULL DEFAULT 0
├── display_name             text
├── user_config              text                             (plaintext JSON)
├── encrypted_credentials    text                             (NOT NULL if plugin has credentialsSchema)
├── credentials_iv           text                             (NOT NULL if encrypted_credentials is set)
├── token_expires_at         integer
├── last_verified_at         integer
├── last_exhausted_at        integer                          (user-pool bookkeeping)
├── retry_after              integer                          (user-pool bookkeeping)
├── error_message            text
├── created_at               integer NOT NULL
├── updated_at               integer NOT NULL
├── INDEX(user_id, plugin_id)
```

**Why `user_config` & `credentials` in different columns:** independent lifecycles. `user_config` plaintext, low-stakes; `encrypted_credentials` secret material with own IV. Cron token refresh re-encrypts creds without touching config; editing Seerr URL rewrites config without touching creds.

**Rows ∃ only for plugins with user-scoped capabilities.** `auth.kind: "none"` + only global capabilities → ⊥ `service_connections` rows. `auth.kind: "none"` + ≥1 user-scoped capability (notification channels) → rows persist with `encrypted_credentials` = encrypted-`{}` placeholder; `user_config` carries the channel config.

### `plugin_store`

KV backing `ctx.store`.

```
plugin_store
├── plugin_id      text FK → plugins.id, NOT NULL
├── user_id        text FK → user.id                         (nullable; null = plugin-global)
├── key            text NOT NULL
├── value          text NOT NULL                             (JSON)
├── expires_at     integer                                   (unix timestamp, nullable)
├── created_at     integer NOT NULL
├── updated_at     integer NOT NULL
├── PRIMARY KEY(plugin_id, user_id, key)
├── INDEX(expires_at)
```

Namespace enforcement in host bridge. Nightly sweep prunes expired rows.

### `pending_auth`

Short-lived OAuth state store.

```
pending_auth
├── nonce            text PK
├── user_id          text FK → user.id, NOT NULL
├── plugin_id        text FK → plugins.id, NOT NULL
├── state            text NOT NULL                           (encrypted, opaque to host)
├── state_iv         text NOT NULL
├── created_at       integer NOT NULL
├── expires_at       integer NOT NULL                        (15 min TTL)
```

### `id_map` (unchanged)

As in initial design. Populated opportunistically by host as capability calls return cross-service IDs.

## Lifecycle

### Install (admin-initiated)

1. Fetch JS from `source_url` (| read from bundled path for built-ins).
2. Compute sha256. If caller provided `expectedChecksum`, compare; mismatch aborts.
3. Boot throwaway QuickJS instance. Call `getManifest()`. Tear down.
4. Validate manifest against host's Zod schema, including derived rules (scope consistency, required schemas per plugin shape, etc.).
5. Compatibility: `manifest.sdkVersion` satisfies host's current SDK semver.
6. Confirm ∀ declared capabilities ∃ in host registry at declared `(version, scope)`.
7. Confirm plugin exports ∀ declared capability methods & job handlers.
8. Write JS to `data/plugins/<plugin_id>/<version>/plugin.js`.
9. Insert `plugins` row (`personal_key_fallback` defaults `'off'`).
10. Register capabilities indexed by `(id, version, scope)`; register jobs with croner.
11. Boot long-lived runtime instance.

Admin-owned shared creds added after install via `plugin.addSharedCredential`. Newly-installed plugin with no shared creds → global-scoped calls return `CAPABILITY_UNAVAILABLE` until admin configures one.

∀ failure → clean rollback. ⊥ partial state.

### Update

Full install flow against new version. On success: tear down old instance, stop old cron jobs, update `plugins` row, retain old `<version>/` directory on disk, boot new instance, register new jobs. On failure → old version stays active.

### Enable / Disable

Admin toggles `plugins.enabled`. Runtime tears down instance, unregisters capabilities & jobs. Existing `service_connections` untouched. `MediaService` returns "plugin disabled" errors. Re-enabling restores everything.

### Uninstall

Delete `plugins` row (cascade deletes `service_connections` & `plugin_store` rows). Delete `data/plugins/<plugin_id>/`. Tear down runtime, unregister capabilities & jobs. Invalidate caches tagged to plugin.

### Token Refresh & Scheduled Work

Declared in `manifest.jobs`. Host croner fires each job at schedule.

- **Plugin-global jobs:** handler called once per tick with plugin-scoped `ctx` (no user creds).
- **`perConnection: true` jobs:** host iterates ∀ `service_connections` rows for plugin, builds user-scoped `ctx`, calls handler per row. Handler returns new creds (| throws). Host re-encrypts & updates row. Used for token refresh & health checks.

Iteration in host keeps plugins simple & consistent.

## API Endpoints (RPC)

### Admin — Plugin Management

Permission: `admin:plugins`.

**Core lifecycle:**

- `plugin.list` — ∀ installed plugins with manifest, version, enabled, install date, `personalKeyFallback`, `poolable`, `sharedCredentialsCount`, `capabilities: Array<{ id, version, scope }>`. ⊥ decrypted secrets.
- `plugin.install` — `{ sourceUrl, expectedChecksum? }` → new plugin row. _(Deferred — requires QuickJS sandbox; see §Deferred.)_
- `plugin.update` — `{ pluginId, sourceUrl, expectedChecksum? }` → updated row. _(Deferred — same prerequisite.)_
- `plugin.uninstall` — `{ pluginId }` → full cascade (drops shared creds, connections, store entries). Built-in plugins ⊥ uninstallable.
- `plugin.setEnabled` — `{ pluginId, enabled }`.
- `plugin.rollback` — `{ pluginId, toVersion }`, only versions still on disk. _(Deferred.)_

**Plaintext global config (admin):**

- `plugin.setGlobalConfig` — `{ pluginId, config }`, validated against `globalConfigSchema`. Stored plaintext.
- `plugin.getGlobalConfig` — returns plaintext global config for admin UI.

**Shared credentials pool (admin):**

- `plugin.listSharedCredentials` — `{ pluginId }` → array of `{ id, label, enabled, lastExhaustedAt, retryAfter, createdAt, updatedAt }`. ⊥ decrypted values.
- `plugin.addSharedCredential` — `{ pluginId, label, value }`. Value validated against `sharedCredentialsSchema` & encrypted before write. Rejected if plugin ⊥ `poolable` & entry already ∃.
- `plugin.updateSharedCredential` — `{ pluginId, credentialId, label?, value?, enabled? }`. Omitted fields preserved (merge semantics).
- `plugin.deleteSharedCredential` — `{ pluginId, credentialId }`. ⊥ count guard; deleting last enabled entry → global-scoped calls return `CAPABILITY_UNAVAILABLE` until another added.
- `plugin.testSharedCredential` — `{ pluginId, credentialId }` → `{ ok, message? }`. Host builds runtime `ctx` with that specific cred & calls plugin's `testConnection` (| for pure-global `auth.kind: "none"`, reserved lightweight probe | optional `verifyShared` handler).

**Fallback policy (admin):**

- `plugin.setPersonalKeyFallback` — `{ pluginId, policy: "off" | "admin-first" | "personal-first" }`. Only meaningful for plugins with ≥1 user-scoped capability; rejected for pure-global plugins. Default `"off"`.

### User — Connection Management

Permission: `account:connections`. Scoped to authenticated user.

**Reads:**

- `connection.list` — user's connections with plugin manifest merged in. Includes `userConfig` with `x-secret` & `x-private` stripped; ⊥ credentials.
- `connection.getUserConfig` — `{ connectionId }` → `user_config` with `x-secret` & `x-private` stripped (for edit-form prefill). ⊥ credentials.
- `plugin.listAvailable` — plugins user can connect to. **Only returns plugins with ≥1 user-scoped capability.** Each entry:
  - `userScopedCapabilities: Array<{ id, version }>` — what connection unlocks.
  - `globalScopedCapabilities: Array<{ id, version }>` — informational; already available, ⊥ connection needed.
  - `poolable: boolean` — drives whether UI offers "add another instance".
  - `adminSharedAvailable: boolean` — true when admin configured ≥1 enabled shared-cred entry. UI uses for "metadata already works out of the box" language on mixed plugins.

**Writes — form auth:**

- `connection.create` — `{ pluginId, userConfig, displayName? }`.
- `connection.updateUserConfig` — `{ connectionId, userConfig }`. Host **merges** incoming payload over prior decrypted `userConfig` (incoming wins where present) → `x-secret` & `x-private` fields client omits preserved. For `auth.kind === "form"`: host re-runs `startAuth(ctx, mergedUserConfig)` to validate upstream & produce fresh creds, writes both columns atomically. Other auth kinds: host runs `testConnection` against existing creds + merged userConfig, writes only `user_config`. On verification failure → both columns preserved.
- `connection.updateDisplayName` — cosmetic, ⊥ plugin involvement.

**Writes — OAuth redirect:**

- `connection.initiateOAuth` — `{ pluginId }` → `{ redirectUrl, nonce }`.
- Completing redirect flow. Two approaches, both valid:
  - **SPA / frontend-driven (current):** Provider redirects to frontend. Frontend extracts `code` & `state`, calls `connection.completeOAuth` — `{ nonce, queryParams }` → `{ connection }`. ⊥ server-side session cookie. Natural for SPA.
  - **Server-side callback (future):** Regular HTTP handler at `GET /api/oauth/callback/:pluginId` receives provider redirect. Host looks up `state` in `pending_auth`, calls `completeAuth(ctx, queryParams, state)`, encrypts creds, redirects to confirmation page. Needed for native apps, server-rendered clients.

**Writes — OAuth device:**

- `connection.initiateDeviceAuth` — `{ pluginId }` → `{ userCode, verifyUrl, nonce, intervalSec, expiresAt }`.
- `connection.pollDeviceAuth` — `{ nonce }` → pending | completed | error.

**Writes — common:**

- `connection.setDefault` — `{ connectionId }`.
- `connection.setEnabled` — `{ connectionId, enabled }`.
- `connection.delete` — auto-promotes another instance to default if needed.
- `connection.test` — `{ connectionId }`. Calls `testConnection(ctx)` on plugin. Updates `last_verified_at` on success, `status="error"` on fail.

## Shared-Credentials Behaviour for TMDB / TVDB

Former bespoke "shared-key model" = instance of general scope + pool system:

- TMDB/TVDB declare `metadata` & `idResolve` as `scope: "global"`. ⊥ user connection needed; run entirely off admin pool.
- When TMDB/TVDB expose user-scoped capabilities (watchlist, ratings) → require user connection with real creds. Users without connection still get global capabilities from admin pool; ⊥ can sync personal watchlist.
- `poolable: true` for TMDB/TVDB; admins configure multiple API keys; host rotates/fails over.
- `personalKeyFallback` lets admin decide how admin pool & user's personal keys interact for user-scoped calls — ⊥ mixing keys across users.

## Self-hosted Network Topology

Media-manager, Plex, Jellyfin, & browser that opens deep link often live on three different network vantage points. Typical docker-compose: media-manager reaches Plex at `http://plex:32400` over private bridge; user's phone reaches at `https://plex.mydomain.com`. Two URLs ≠ interchangeable; conflating them breaks silently — host talks to Plex fine, but every `playerLink` 404s on client.

Design handles this in three places.

**User-configurable dual URLs on server plugins.** Plex & Jellyfin `userConfigSchema` expose:

- `externalServerUrl` (required, `"x-allowed-host": true`) — URL client can reach. ∀ `playerLink` / `webLink` values ! built from this. Stored plaintext.
- `internalServerUrl` (optional, `"x-allowed-host": true`, `"x-private": true`) — URL host should prefer for `ctx.fetch`. Falls back to `externalServerUrl` when unset. `x-private` keeps this ⊥ appearing in API responses.

When both set: **fetch via internal, return external in ∀ fields leaving server.**

**Dynamic `ctx.fetch` allowlist.** `manifest.allowedHosts` = static floor. For hosts unpredictable at manifest time, runtime unions hostname of every `"x-allowed-host": true` field on current call's connection (| shared-credentials entry | admin-set `globalConfig`). Allowlist recomputed per invocation → rotating to different connection reshapes what `ctx.fetch` can reach. `globalConfigSchema` hosts cover plugins like Seerr where a single admin-configured baseUrl serves every user.

**SSRF mitigation on `x-allowed-host` fields.** Self-hosted deployments require host to reach private-network addresses (`internalServerUrl: http://plex:32400` = the whole point) → blanket RFC1918 block defeats design. Instead, runtime applies narrow blocklist to hostnames resolved from `x-allowed-host` fields before adding to per-call allowlist:

- Cloud instance-metadata endpoints: `169.254.169.254` (AWS/GCP/Azure IMDS), `fd00:ec2::254` (IMDSv6), `100.100.100.200` (Alibaba), `metadata.google.internal`.
- Loopback: `127.0.0.0/8` & `::1`.
- Link-local outside metadata blocklist: `169.254.0.0/16` & `fe80::/10`.

DNS resolution for `x-allowed-host` URLs happens inside `ctx.fetch` → runtime applies blocklist to resolved address (not just hostname string) to mitigate DNS-rebinding. RFC1918 / ULA / unique-local ranges deliberately **allowed** — expected topology for docker-compose & LAN deployments.

**App-level external URL for OAuth & link-backs.** Host reads `APP_EXTERNAL_URL` (env var) for:

- OAuth `redirect_uri` values plugin returns from `startAuth` (`${APP_EXTERNAL_URL}/oauth/callback/${plugin_id}`). Plugins ⊥ construct this — runtime injects via `ctx.appBaseUrl`.
- ∀ absolute links host returns in API responses expected to be opened by browser.

`APP_EXTERNAL_URL` ! in production. Dev defaults to `http://localhost:<port>`. Misconfigured value fails fast: host validates on startup it's well-formed absolute URL; OAuth providers reject non-matching redirect URI → surfaces at first connection attempt, ⊥ silently.

## Preference Profiles

Host-owned internal state, ⊥ plugin concern. Rebuild job reads from `watchHistory@v1`, `ratings@v1`, `metadata@v1`, & `feedback_log` table → writes to existing `preference_profiles` table. ⊥ new capability.

If plugin later needs to read user's profile → injected via `ctx.userProfile`, ⊥ exposed as capability. Pluggable scoring algorithms ⊥ in scope for v1.

## Caching

Cache keys: `mv:{capability}:{version}:{method}:{scope_segment}:{args_hash}`, where `{scope_segment}` = `user:{user_id}` for user-scoped | `global` otherwise. Connection create/update/delete invalidates relevant per-user cache entries. `CacheProvider` supports in-memory (lru-cache) & optional Redis.

Scope segment comes from _resolved_ scope of request, not capability-level flag. Fixed-scope capabilities equivalent to old rule. Mixed-scope capabilities → dispatcher calls `scopeForInput(input)` once per request; result used for both provider lookup & cache key — user-scoped branch of mixed capability (e.g. `idResolve@v1` with `from: "plex:ratingKey"`) ⊥ pollute | serve from global cache.

## Testing

- ∀ host capabilities have unit tests with fake plugin returning fixture data. Covers input/output validation, fan-out, error paths.
- ∀ built-in plugins have contract tests: calls each declared capability with mocked `ctx`, verifies shape & behavior.
- _(Future — QuickJS sandbox)_ Plugin runtime integration tests for sandbox boundary: fetch allowlist enforcement, memory cap, call timeout, store namespacing.
- _(Future — 3rd-party install)_ Lifecycle tests covering install rollback on each validation failure.

## Migration from Current Implementation

Codebase already has plugin runtime with old capability/credentials shape. One-time migration:

**Schema:**

1. Add `plugin_shared_credentials` table.
2. ∀ existing `plugins` rows where `shared_credentials IS NOT NULL`: insert one `plugin_shared_credentials` row with `label: "Primary"`, copying `encrypted_value` & `iv`. Preserves admin-configured keys.
3. Drop `plugins.shared_credentials` & `plugins.shared_credentials_iv`.
4. Add `plugins.personal_key_fallback TEXT NOT NULL DEFAULT 'off'`.
5. Add `service_connections.last_exhausted_at` & `service_connections.retry_after` (user-pool rotation bookkeeping).

**Manifest shape (stored on `plugins.manifest`):**

Re-parse each stored manifest at migration & coerce:

- `capabilities: Record<string, string>` → `Record<string, { version, scope }>` using built-in defaults table (e.g. `metadata`/`idResolve` → `global`; `watchHistory`/`watchlist`/`ratings`/`mediaRequest`/`calendar`/`recommendations` → `user`).
- Drop `allowsSharedCredentials` (folded into scope + `personalKeyFallback`).
- Set `poolable` from built-in defaults map (`tmdb`, `tvdb` → `true`; `trakt`, `seerr` → `false`).

Defaults table lives in migration code, ⊥ runtime code.

**Data cleanup — remove empty-creds rows:**

Current TMDB behavior creates `service_connections` rows with empty `credentials: {}` when user submits form without key. Nonsense under new rules. Migration decrypts each TMDB connection's creds & deletes rows whose plaintext creds are empty. Users with real personal keys → unchanged.

**Built-in plugin code updates (out of scope for this doc, tracked):**

- TMDB `startAuth` ⊥ produce empty-creds results; requires real key | returns `status: "error"`.
- ∀ built-in manifests updated to new capability shape with explicit `scope`.
- TMDB & TVDB: `poolable: true`. Trakt & Seerr: `poolable: false`.
- References to `ctx.sharedCredentials` stay valid; injection contract moves from `allowsSharedCredentials` to scope-based selection.

## Deferred to Future Revisions

### QuickJS WASM Sandbox

**What:** Replace trusted-TypeScript-module model with proper QuickJS WASM sandbox (`quickjs-emscripten`) → 3rd-party plugin code runs isolated from host process.

**Why deferred:** ∀ current plugins = built-ins in same codebase, same review process as host. Sandboxing complexity only justified when untrusted 3rd-party code involved.

**Prerequisites:**

- `sandbox.ts` — QuickJS instance wrapper; one long-lived instance per plugin, booted at startup & rebooted on install/update.
- `host-bridge.ts` — implementations of ∀ `ctx.*` methods crossing sandbox boundary (fetch, log, store, pool).
- Per-instance memory cap (default 64 MB, configurable).
- Per-call timeout (30 s) via QuickJS interrupt handler.
- Sandbox OOM/timeout recovery: runtime reboots instance on next use; affected connection marked error.
- ∀ built-in plugins ! compiled to plain JS bundles for loading into QuickJS.

### Third-party Plugin Install, Update, Rollback

**What:** Admin-initiated lifecycle for plugins from URL rather than bundled in codebase.

**Endpoints (deferred):**

- `plugin.install` — `POST /api/plugins` — `{ sourceUrl, expectedChecksum? }`. Fetches JS, computes sha256, boots throwaway QuickJS to call `getManifest()`, validates, writes to `data/plugins/<id>/<version>/plugin.js`, inserts `plugins` row.
- `plugin.update` — `PATCH /api/plugins/:id/source` — `{ sourceUrl, expectedChecksum? }`. Full install flow against new version; on success tears down old instance, stops old cron, retains old version dir, boots new.
- `plugin.rollback` — `POST /api/plugins/:id/rollback` — `{ toVersion }`. Only versions on disk (last 3 retained).

**Why deferred:** All three require QuickJS sandbox — load untrusted JS into throwaway instance to extract manifest; long-lived runtime instance = QuickJS instance.

### Server-side OAuth Redirect Callback

**What:** `GET /api/oauth/callback/:pluginId` — regular HTTP handler receiving provider redirect (for native apps, server-rendered clients, | any context where frontend ⊥ intercept redirect).

**Current:** SPA-driven — frontend catches provider redirect, extracts `code` & `state`, calls `POST /api/connections/oauth/redirect/complete` with `{ nonce, queryParams }`. Both approaches share same underlying `completeAuth` plugin call & `pending_auth` state resolution; only transport differs.

**Why deferred:** SPA path covers ∀ current client use cases. Server-side callback adds complexity (CSRF handling, post-redirect client-notification strategy) not justified until non-SPA client ∃.

---

## Open Questions / Deferred

- **Pool rotation strategy.** v1 ships round-robin. Sticky-per-user, weighted, | quota-aware pickers = future work once telemetry shows uneven distribution.
- **Admin pool telemetry dashboards.** `last_exhausted_at` / `retry_after` columns ∃ to back this; UI surface ⊥ in scope for v1.
- **Cross-plugin events.** Deferred until concrete use case appears.
- **User-installable plugins from admin allowlist.** Data model leaves room via future `plugin_allowlist` table; ⊥ built in v1.
- **Auto-update.** Manual only in v1.
- **Marketplace / discovery.** ⊥ in scope.
- **`serverPlaylists@v1`.** CRUD for server-side playlists (Plex `/playlists/*`, Jellyfin `/Playlists/*`). Real value for "add to Friday movie night" flows, ⊥ feeds home feed directly. Revisit once concrete consumer appears.
- **`markers@v1` (skip-intro / skip-credits).** Plex exposes cleanly via `Marker` elements; Jellyfin intro-skip = plugin-only & unstable. Held until Jellyfin stabilises so it ships as cross-server capability ⊥ Plex-only.

# Plugin Architecture for Connections

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Supersedes:** Initial Connections design (non-plugin)

## Summary

The connections subsystem is being redesigned so that every service integration (Trakt, Seerr, TMDB, TVDB, self-hosted media servers such as Plex and Jellyfin, and any future third-party service) is implemented as a plugin. Built-in services ship as bundled plugins in the same format as third-party ones. Capabilities are versioned, schema-validated, and discoverable at runtime, so the host can fan out feature calls (watch history, recommendations, media requests, library availability lookups, etc.) to whichever plugins implement them.

> **v1 scope note:** Built-in plugins currently run as trusted TypeScript modules within the host process — there is no sandbox boundary between them and the host. The QuickJS WASM sandbox (and the third-party plugin install/update/rollback endpoints that depend on it) are deferred to a future revision. See the "Deferred to future revisions" section.

Capabilities declare a **scope** — `global` or `user` — so a single plugin can legitimately expose both a server-wide data source (e.g. TMDB metadata) and per-user integrations (e.g. TMDB watchlist). Admins can configure an **admin-owned pool** of shared credentials for pool-safe plugins so quota-limited services like TMDB can fail over across multiple keys. Users with user-scoped capabilities authenticate normally and may have multiple distinct connections of their own; a per-plugin `personalKeyFallback` policy optionally links the two pools for per-user requests without ever sharing keys across users.

This document is the authoritative spec for the backend design. A later document will cover the frontend.

## Goals

- One abstraction for all service integrations. Built-ins and third-party plugins go through the same interface.
- Plugins are extensible feature-by-feature. New capabilities can be added to the host without breaking existing plugins.
- Plugins are sandboxed. They can only do what the host explicitly grants.
- Typed development for plugin authors via a host-generated `.d.ts` file.
- Multi-instance-per-service support preserved from the initial design.
- First-class distinction between global-scoped capabilities (server-wide, driven by admin-owned credentials) and user-scoped capabilities (per-user auth). A single plugin can expose both.
- Admin-owned credentials may be pooled for pool-safe plugins (e.g. multiple TMDB API keys) with host-driven rotation and failover.
- No nonsense states: a user connection can only exist if it carries real credentials for the plugin's user-scoped capabilities.
- All credential material is encrypted at rest (AES-256-GCM). Plaintext `*_config` columns stay plaintext; `*_credentials` columns are always encrypted.

## Non-goals

- Plugin marketplace or auto-update. Admin installs plugins manually by URL.
- User-installed plugins in v1. Schema and design leave room for an admin-curated allowlist later.
- Cross-plugin event bus. Plugins do not call other plugins directly.
- Pluggable internals beyond the service integration layer (e.g. swappable scoring for preference profiles is out of scope).

## Architecture overview

Three layers:

- **Host** — the application itself. Owns the database, encryption, authentication, cron (croner), oRPC, and the plugin runtime. Never trusts plugin code.
- **Plugin runtime** — a host-owned subsystem that loads, sandboxes, and invokes plugins. Exposes a narrow `PluginContext` and nothing else.
- **Plugins** — self-contained JavaScript files. Each declares a manifest, implements one or more capability interfaces, and handles its own auth ceremony.

Central components:

- `MediaService` is the only surface the rest of the app talks to. oRPC procedures and MCP tools never call plugins directly.
- The **capability registry** (in-memory, rebuilt on plugin install/update/disable) maps `(capability, version, scope)` to a list of plugins that implement it. Global-scoped and user-scoped lookups are independent — "who provides `metadata@v1` globally?" and "who provides `watchlist@v1` for a given user?" are separate queries.
- `MediaService` dispatches calls through the runtime. For global-scoped calls, it picks a `shared_credentials` entry from the admin pool (rotating for pool-safe plugins). For user-scoped calls, it resolves the user's connection(s) and picks credentials from the user's pool (per-plugin `poolable` flag). An optional `personalKeyFallback` policy lets exhaustion on one side fall through to the other, strictly within a single user's request.
- **Connections** are bound to plugins by `plugin_id`, not a hardcoded service enum, and exist only for plugins that expose at least one user-scoped capability.

Carried over from the initial design unchanged:

- AES-256-GCM encryption with per-user derived keys.
- `id_map` table for cross-service ID resolution, populated opportunistically.
- `account:connections` permission, per-user scope (admins cannot edit other users' connections).
- Multi-instance per service type with a default-instance (user-side).
- Connections can be disabled without removal.

Removed:

- The `service` enum (`"trakt" | "tmdb" | "seerr" | "tvdb"`) on `service_connections`. Replaced by `plugin_id`.
- The `integrations/` folder structure. Each former integration becomes a bundled plugin.
- The ad-hoc `allowsSharedCredentials` manifest flag and the bespoke "Shared-key model" special case. Both are now folded into the general scope + pool model.

## Plugin manifest

Every plugin exports a `getManifest()` function returning this shape. Validated against a host-side Zod schema at install time.

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
  capabilities: Record<
    string,
    {
      version: string; // e.g. "v1"
      scope: "global" | "user";
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

**Why JSON Schema, not Zod, for config shapes.** JSON Schema is inert data that renders on the frontend with a generic renderer (e.g. `@rjsf/core`) and validates server-side with `ajv`. It is also the only viable choice once third-party plugins run in a QuickJS sandbox, where bundling Zod would be overkill. The host's own internal schemas stay Zod — they are host code.

**`x-secret` extension.** Properties marked `"x-secret": true` are treated as secrets by the host and frontend. The frontend renders them as masked inputs and never displays their values on connection cards. The host strips them from `connection.list` and `connection.getUserConfig` responses. On `updateUserConfig`, omitted secret fields are preserved by merging with the prior stored value rather than blanked out. `sharedCredentialsSchema` is implicitly a secret schema — the host never returns decrypted values to any API response.

**`x-private` extension.** Properties marked `"x-private": true` are stored plaintext but stripped from every API response the host returns to clients. `x-private` protects operationally-sensitive-but-non-secret values (for example, a private-network server URL) from accidental client exposure without requiring the full encryption-at-rest cost of `x-secret`. The read-side behaviour mirrors `x-secret`: omitted fields on `updateUserConfig` are preserved by merging with the prior stored value, and connection-card-type responses never surface the value. A field may carry both `x-secret` and `x-private` if wanted; it is then encrypted at rest AND stripped from responses.

**`x-allowed-host` extension.** Properties marked `"x-allowed-host": true` in a plugin's `userConfigSchema` or `sharedCredentialsSchema` are URL-valued fields whose hostname is added to the per-call `ctx.fetch` allowlist, unioned with the plugin's static `manifest.allowedHosts`. This is how self-hosted services like Plex and Jellyfin can accept user-supplied server URLs that cannot be pre-declared in `manifest.allowedHosts`. The host resolves the dynamic host set at every invocation: user-scoped calls read the active connection's `userConfig`; admin/global-scoped calls read the picked `shared_credentials` entry. Aux contexts (auth flows, job handlers, `testConnection`, refresh) union both sides. A malformed URL in an `x-allowed-host` field fails the call with `plugin.input_invalid` — the allowlist is not silently degraded. See "Self-hosted network topology".

**`sdkVersion` is a hard compatibility gate.** Install fails fast with a clear error when a plugin targets an incompatible SDK.

### Derived validation rules

Applied at manifest install:

| Plugin shape              | `auth.kind` (user ceremony) | `sharedCredentialsSchema`          | `credentialsSchema` | `userConfigSchema` | `poolable` allowed |
| ------------------------- | --------------------------- | ---------------------------------- | ------------------- | ------------------ | ------------------ |
| All capabilities `global` | must be `"none"`            | typically required (e.g. API key)  | must be **absent**  | must be **absent** | yes                |
| Any capability `user`     | must not be `"none"`        | optional (e.g. OAuth client creds) | **required**        | optional           | yes                |
| Mixed (both scopes)       | must not be `"none"`        | typically required                 | **required**        | optional           | yes                |

A plugin whose declared scope changes between versions (e.g. moving a capability from `global` to `user`) is considered a breaking change — the host rejects minor/patch bumps that alter scope.

### Concrete plugin mappings

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

## Plugin entry point

A plugin is a single JS file that exports a default object built with `definePlugin` (a pure identity helper for type inference).

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

`testConnection(ctx)` is required for any plugin with `auth.kind !== "none"`. It is called by the UI's "test" button, the health-check cron, and as a pre-commit check during `connection.updateUserConfig`. For pure-global plugins (`auth.kind === "none"`), admins verify shared-credential entries via `plugin.testSharedCredential` instead (see API section).

## Auth ceremony — flow types

The host orchestrates auth based on `manifest.auth.kind`. Plugin functions return discriminated-union status payloads; the host drives the UI.

Every `status: "completed"` payload has the shape `{ status: "completed", credentials, userConfigPatch? }`. The optional `userConfigPatch` merges into the submitted `userConfig` before the `service_connections` row is written — used by plugins that resolve server-side identifiers during auth (for example Jellyfin's `userId` from `/Users/Me`) without round-tripping through the client. Keys in `userConfigPatch` must be declared on `userConfigSchema`; the host validates the merged result against the schema and rejects any key the plugin attempts to smuggle in.

**`form`** (e.g. Seerr):

1. Frontend collects `userConfig` fields from `userConfigSchema`.
2. Host calls `startAuth(ctx, userConfig)`. Plugin tests the credentials and returns `{ status: "completed", credentials, userConfigPatch? }`.

**`oauth_redirect`** (standard OAuth2):

1. Host calls `startAuth(ctx, null)`. Plugin returns `{ status: "redirect", url, state }`.
2. Host stashes `state` in a `pending_auth` row keyed by a nonce.
3. Frontend redirects user.
4. Provider redirects back to the host callback route. Host looks up `state`, calls `completeAuth(ctx, queryParams, state)`, receives `{ status: "completed", credentials, userConfigPatch? }`.

**`oauth_device`** (e.g. Trakt):

1. Host calls `startAuth(ctx, null)`. Plugin returns `{ status: "display_code", code, verifyUrl, pollState, intervalSec }`.
2. Host returns code + verifyUrl + nonce + intervalSec to the frontend.
3. Frontend displays instructions, polls `connection.pollDeviceAuth(nonce)` at `intervalSec`.
4. Each poll: host calls `pollAuth(ctx, pollState)`. Plugin returns `pending`, `completed` (with optional `userConfigPatch`), or `error`.

**`none`**: plugin has no per-user credentials. Only legal for pure-global plugins (every capability has `scope: "global"`). No `service_connections` rows exist for these plugins; they run entirely off admin-owned shared credentials and global config.

On `status: "completed"`, host merges `userConfigPatch` (if any) into the submitted `userConfig`, validates the merged result against `userConfigSchema`, encrypts the credentials, creates the `service_connections` row, auto-promotes to default if it's the first instance, and returns the connection to the frontend. **Empty-credentials rows are rejected**: if the validated credentials payload for a plugin that declares `credentialsSchema` is missing required fields or resolves to an empty object, the create is refused with a typed error rather than producing a "parked" connection.

Credentials and device codes are never logged. `pending_auth` rows have a 15-minute TTL with a nightly sweep.

## Capability interfaces

Capabilities are the typed contract between host and plugin. Host defines them as Zod schemas; a build script generates a `.d.ts` from those schemas and commits it to the repo. Plugin authors import the generated types for dev-time safety.

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

Enforcement by the runtime on every invocation:

- Validate input against the capability's Zod input schema before calling the plugin.
- Validate output against the Zod output schema after the call returns. Bad output throws before reaching `MediaService`.
- Version pinning. A caller asking for `watchHistory@v1` is not matched by a plugin declaring `watchHistory: "v2"`.
- Scope routing. The registry is indexed by `(capability_id, version, scope)`; `MediaService` asks for "who provides X at scope Y". For most capabilities the scope is fixed on the host-side definition (`scope: "global"` or `scope: "user"`) and callers always land on that pool. Capabilities that need to accept both (today: `idResolve@v1`) declare `scope: "mixed"` on the host definition and supply a pure `scopeForInput(input)` classifier. The dispatcher calls the classifier once per request and threads the resolved scope through both the provider lookup and the cache key — so a user-scoped resolution (e.g. `from: "plex:ratingKey"`) visits only user-scoped providers and is cached under `user:{user_id}`, and a global resolution (e.g. `from: "tmdb"`) visits only global providers and is cached globally. Provider enumeration and cache-keying see the same scope on every request, which is what prevents a server-local handle from leaking across users through a shared cache entry.

**Versioning policy.** Breaking changes introduce a new version alongside the old. Old plugins keep working until no consumer needs v1, at which point v1 can be removed host-side. No forced upgrades. Scope changes on a capability (global ↔ user) always constitute a breaking change and require a new major version.

**Initial capability set (with canonical scope; plugins may still declare the opposite where it makes sense, e.g. a plugin that exposes `metadata` from a personal library):**

- `metadata@v1` — search, get by id, similar titles, discover, trending. Typically `global`.
- `watchHistory@v1` — get/add/remove history. Output carries `watchedAt`, optional `progress`, optional `rewatchCount`. Typically `user`.
- `watchlist@v1` — get/add/remove watchlist. Typically `user`.
- `ratings@v1` — get/set/remove ratings. Typically `user`.
- `recommendations@v1` — personal recommendations, trending, anticipated. Typically `user` (may accept a `global` variant for anonymous trending).
- `calendar@v1` — upcoming TV episodes and movie releases. Typically `user`.
- `mediaRequest@v1` — request media, check availability, cancel requests. Typically `user`.
- `idResolve@v1` — resolve one id type to others; feeds `id_map`. Host-side this is the canonical **mixed-scope** capability: metadata providers (TMDB, TVDB, Trakt) register `scope: "global"` on their manifest and handle cross-service ids; media-server plugins (Plex, Jellyfin) register `scope: "user"` and handle server-local handles (`plex:ratingKey`, `jellyfin:itemId`). The host-side `CapabilityDefinition` declares `scope: "mixed"` with a `scopeForInput` classifier so the dispatcher can pick the right pool per request. Server-local handles are per-server and per-account, so they cannot be global.
- `userComments@v1` — get user's own comments. Typically `user`.
- `watchProviders@v1` — streaming/rent/buy availability per media item per region. Typically `global`.
- `trailers@v1` — trailer/teaser/clip videos per media item. Typically `global`.
- `playback@v1` — cross-device resume positions. Typically `user`.
- `collection@v1` — user's owned/collected library. Typically `user`.
- `libraryAvailability@v1` — check whether a media item exists on a connected media server (Plex, Jellyfin), with quality details and a deep-play link. Typically `user`. Distinct from `collection@v1`, which is user-curated "I marked this as owned" state rather than ground-truth file presence on a server.
- `playbackSessions@v1` — currently-playing sessions across the user's server: device, user, item, progress, transcoding state, plus a stop action. Typically `user`. Distinct from `playback@v1` (historical resume points) and from any future `transcoding@v1` — transcoding details ride along on the session payload so a dedicated capability is unnecessary.
- `continueWatching@v1` — server-computed "pick up where you left off" feed, including Next Up episode stitching. Typically `user`. Distinct from `playback@v1` (raw positions) — this capability returns the server's own ranking of what to watch next, already joined to Next Up logic for TV shows, which the client does not want to reimplement.
- `libraryAdmin@v1` — trigger library scan / metadata refresh on demand. Typically `user`, but intended to be called by the host after a `mediaRequest@v1` fulfils (so a newly-grabbed file lands in the library immediately instead of on the next periodic scan). App-layer authorisation may restrict this to admins.

**Capability discipline.** A plugin that declares a capability must implement _every_ method declared on it — the loader rejects plugins with missing method implementations. If a service does not natively support a method in a capability, the plugin should either (a) not declare that capability at all, or (b) degrade gracefully (empty array / `{ ok: false }`) rather than silently ignoring the call. This keeps the routing matrix boolean — callers can assume "this plugin claims watchHistory" means every watchHistory method works on it.

New capabilities are added over time as features land.

### Capability method reference

The sections below enumerate every method on every capability. Entries marked _added_ were introduced alongside this revision; the rest were in the initial capability set.

**`metadata@v1`** (global)

- `search({ query, type?, limit? })` → `Array<{ item, score? }>`
- `getDetails({ id, type })` → `MediaItem`
- `getSimilar({ id, type })` → `MediaItem[]`
- `getTrending({ type?, limit? })` → `MediaItem[]`
- `discover({ genres?, yearMin?, yearMax?, ratingMin?, limit? })` → `MediaItem[]`

**`watchHistory@v1`** (user)

- `getHistory({ limit?, since? })` → `HistoryEntry[]`
- `addToHistory(items)` → `{ added }`
- _added_ `removeFromHistory(items)` → `{ removed }` — closes the symmetry gap with `addToHistory`. Backed by Trakt `POST /sync/history/remove`.

_Media-server backings (added this revision):_ Plex `GET /:/scrobble` + `GET /:/unscrobble` + `GET /status/sessions/history/all`, and Jellyfin `POST /Users/{userId}/PlayedItems/{itemId}` + `DELETE /Users/{userId}/PlayedItems/{itemId}`. Both servers operate on server-local item handles (`plex:ratingKey`, `jellyfin:itemId`), so `addToHistory` / `removeFromHistory` call the plugin's own `idResolve@v1` implementation first to translate the incoming cross-service id — see the `idResolve@v1` section below.

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
- _added_ `getAnticipated({ type?, limit? })` → `MediaItem[]` — distinct from trending (future vs. now). Backed by Trakt `/movies/anticipated`, `/shows/anticipated`.

**`calendar@v1`** (user)

- `getUpcoming({ days? })` → `UpcomingEntry[]` — TV episodes.
- _added_ `getUpcomingMovies({ days? })` → `UpcomingEntry[]` — movie releases. Backed by Trakt `/calendars/my/movies/{start}/{days}`. Returned entries have `season`/`episode` unset.

**`mediaRequest@v1`** (user)

- `checkAvailability({ tmdbId, type })` → `{ status }`
- `createRequest({ tmdbId, type, seasons? })` → `{ success, requestId?, message? }`
- `listRequests({})` → `RequestRow[]`
- _added_ `cancelRequest({ requestId })` → `{ ok }` — backed by Seerr `DELETE /request/:id`.

**`idResolve@v1`** (mixed — see ["additional id-types for media servers"](#idresolvev1--additional-id-types-for-media-servers) below for the mixed-scope routing rules)

- `resolve({ from, id, type })` → partial id bundle.

**`userComments@v1`** (user)

- `getComments({ limit? })` → `CommentEntry[]`

**`watchProviders@v1`** (global, _new capability_)

- `getProviders({ id, type, region? })` → `{ streaming: string[], rent: string[], buy: string[] }` — provider names. `region` defaults to the host's configured region (fall back to `"US"`). Backed by TMDB `/{type}/{id}/watch/providers`. Feeds the `streaming` field on the `ent_details` MCP tool output that is otherwise dead.

**`trailers@v1`** (global, _new capability_)

- `getVideos({ id, type })` → `Array<{ kind: "trailer" | "teaser" | "clip" | "featurette" | "other", site, key, url, official? }>`. Backed by TMDB `/{type}/{id}/videos`. Feeds the `trailer` field on the `ent_details` MCP tool output.

**`playback@v1`** (user, _new capability_)

- `getPositions({ type? })` → `Array<{ item, progress (0–100), pausedAt, season?, episode?, playbackId }>`
- `removePosition({ playbackId })` → `{ ok }`

Backed by Trakt `/sync/playback` and `DELETE /sync/playback/:id`. Feeds the `watch_progress` field on the `ent_details` MCP tool output.

**`collection@v1`** (user, _new capability_)

- `getCollection({ type? })` → `Array<{ item, addedAt }>` — same shape as `watchlist` entries.
- `addToCollection(items)` → `{ added }`
- `removeFromCollection(items)` → `{ removed }`

Backed by Trakt `/sync/collection/*`. Answers "does the user already own this locally" as a signal distinct from `watchHistory` (seen), `watchlist` (planned), and `mediaRequest` (asked a download manager for it).

**`libraryAvailability@v1`** (user, _new capability_)

- `checkAvailability({ id, idType, type })` → `{ items: LibraryItem[] }` — `idType` is one of the cross-service ids (`"tmdb" | "imdb" | "tvdb"`). Server-local ids (`plex:ratingKey`, `jellyfin:itemId`) are intentionally not accepted here: if a caller already holds a server-local id they have a `LibraryItem` and do not need to re-check availability. Returns zero or more matches so multiple quality copies of the same title (e.g. 4k HDR and 1080p SDR) each surface as their own entry. Backed by Plex `/library/metadata/matches` / `/library/all?guid=...` and Jellyfin `/Users/{userId}/Items?AnyProviderIdEquals=...`.
- `listRecentlyAdded({ type?, limit? })` → `LibraryItem[]` — server-reported recently-imported items for the authenticated user. Feeds a "new on your server" row in the UI. Backed by Plex `/library/recentlyAdded` and Jellyfin `/Users/{userId}/Items/Latest`.
- `searchLibrary({ query, type? })` → `LibraryItem[]` — free-text search scoped to the user's library.

Where `LibraryItem` is:

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

Feeds the `available_on` field on the `ent_details` MCP tool output, replaces ad-hoc "do I own this already" checks, and gives the frontend a one-click "play in Plex / play in Jellyfin" affordance on any media card.

**`playbackSessions@v1`** (user, _new capability_)

- `getSessions()` → `SessionEntry[]` — currently-playing sessions visible to the authenticated connection. Backed by Plex `/status/sessions` (joined with `/transcode/sessions` for transcoding fields) and Jellyfin `/Sessions`. Results are always filtered to the connection's own user: Jellyfin's `/Sessions` returns server-wide sessions for admin tokens, so the plugin MUST post-filter by the cached `userConfig.userId` before returning; Plex's endpoint is already account-scoped but the plugin still drops sessions whose `User.id` does not match the connection's account id. This is a privacy guarantee, not an optimisation — never return another user's session even if the underlying token can see it.
- `stopSession({ sessionId, reason? })` → `{ ok, semantics: "forced" | "requested" }` — ask the server to end a session. Backed by Plex `DELETE /status/sessions/terminate?sessionId=...` and Jellyfin `POST /Sessions/{id}/Playing/Stop`. The two endpoints differ: Plex terminates server-side and the session vanishes from the next `getSessions()` call, while Jellyfin sends a remote-control command to the client, which an offline or unresponsive client may ignore. The `semantics` field returns `"forced"` for Plex and `"requested"` for Jellyfin so UIs can surface the right confirmation ("stopped" vs "stop requested — may take a moment") instead of assuming immediate effect.

Where `SessionEntry` is:

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

Feeds a "playing now on your server" home-feed row and a per-device kill switch. Transcoding fields let the UI surface "your phone is pulling a 12 Mbps transcode" without a separate capability.

**`continueWatching@v1`** (user, _new capability_)

- `getContinueWatching({ type?, limit? })` → `ContinueEntry[]` — the server's own ranking of what to resume or start next. Backed by Plex `/hubs/continueWatching` (falls back to `/library/onDeck` for older servers) and Jellyfin `/Users/{userId}/Items/Resume` merged with `/Shows/NextUp`.

Where `ContinueEntry` is:

```
{
  item:      LibraryItem,    // the thing to resume or start (episode for shows, movie for movies)
  progressMs?: number,       // undefined when this is a "start next episode" entry with no prior position
  nextUp?:   LibraryItem,    // for TV: the episode after `item`, when the server surfaces one
  lastPlayedAt?: string,     // iso, for sorting alongside other feeds
}
```

Reuses `LibraryItem` as the shared shape — no re-definition. Distinct from `playback@v1.getPositions`, which returns raw resume points from sync APIs (Trakt) rather than a curated feed.

**`libraryAdmin@v1`** (user, _new capability_)

- `refreshLibrary({ librarySectionId? })` → `{ ok }` — trigger a full or section-scoped rescan. Fire-and-forget: both Plex `/library/sections/{id}/refresh` (force=1 when `librarySectionId` is omitted across all sections) and Jellyfin `POST /Library/Refresh` return empty bodies and neither exposes a scan id or progress handle. Callers must not expect to poll for completion — the contract is only "the server accepted the rescan request".
- `refreshItem({ serverItemId })` → `{ ok }` — targeted metadata refresh for a single item. Backed by Plex `PUT /library/metadata/{id}/refresh` and Jellyfin `POST /Items/{id}/Refresh`.

Intended caller is the host itself, invoked on completion of a `mediaRequest@v1` fulfilment so the new file lands in the library without waiting on the periodic scan. Can also be surfaced in an admin UI.

**`idResolve@v1`** — additional id-types for media servers

Beyond the existing cross-service ids, this revision adds two server-local id-types:

- `plex:ratingKey` — Plex's per-server item key. Resolvable to `tmdb` / `imdb` via Plex's `Guid` elements on library items. Required for `watchHistory@v1.addToHistory` on Plex (scrobble takes a `ratingKey`, not a TMDB id).
- `jellyfin:itemId` — Jellyfin's per-server item UUID. Resolvable to `tmdb` / `imdb` via `ProviderIds` on the item. Required for `watchHistory@v1.addToHistory` on Jellyfin (`POST /Users/{userId}/PlayedItems/{itemId}`).

Server-local ids are user-scoped (they only mean something against a specific connection), so the Plex and Jellyfin plugins implement `idResolve@v1` with `scope: "user"` — a deliberate departure from the "typically global" pattern on this capability.

**Host-side mixed-scope routing.** The host-side `CapabilityDefinition` for `idResolve@v1` declares `scope: "mixed"` and supplies a pure `scopeForInput(input) → "global" | "user"` classifier: inputs whose `from` contains a `:` (`plex:ratingKey`, `jellyfin:itemId`) resolve `"user"`, everything else (`tmdb`, `imdb`, `tvdb`, `trakt`) resolves `"global"`. The classifier is invoked once per dispatch and its return value is threaded through both the registry lookup (`capabilityRegistry.listProviders(cap, ver, scope)`) and the cache key. The invariant is that provider enumeration and cache-keying agree on the resolved scope for the same request — if they disagreed, a server-local resolution could be written to a global cache entry and served to a different user on the next request.

**Per-request cache-key scoping.** The cache key prefix carries the _resolved_ scope, not the capability's declared scope mode. A `resolve({ from: "tmdb", id: "550" })` request lands on `mv:idResolve:v1:resolve:global:…` (one entry shared across every caller), while `resolve({ from: "plex:ratingKey", id: "42" })` for user Alice lands on `mv:idResolve:v1:resolve:user:alice:…` and for user Bob on `mv:idResolve:v1:resolve:user:bob:…` — two distinct entries, so Bob can never read Alice's cached server-local resolution even though they ran identical arguments. The classifier defensively returns `"global"` for malformed inputs so a bypassed schema cannot smuggle a userId-keyed entry.

**`id_map` scoping for server-local handles.** A user with two Plex connections (two different servers) will produce two distinct `plex:ratingKey` values for the same title — the key is meaningful only against the server that issued it. The `id_map` table therefore keys server-local id rows by `(plugin_id, connection_id, id_type, id_value)` rather than the `(id_type, id_value)` pair used for global-scope ids like `tmdb:`/`imdb:`. Cross-service ids from metadata providers (TMDB, TVDB, Trakt) keep the connection-less key so they remain shareable across users; only id-types that declare themselves server-local inherit the extra dimension. The schema change is additive — the existing `id_map` columns stay, with `plugin_id` and `connection_id` added as nullable and constrained to be non-null for server-local id types.

### Built-in plugin coverage after this revision

| Capability               | TMDB     | Trakt    | Seerr  | TVDB     | Plex   | Jellyfin |
| ------------------------ | -------- | -------- | ------ | -------- | ------ | -------- |
| `metadata@v1`            | ✓ global |          |        |          |        |          |
| `idResolve@v1`           | ✓ global | ✓ global |        | ✓ global | ✓ user | ✓ user   |
| `watchHistory@v1`        |          | ✓ user   |        |          | ✓ user | ✓ user   |
| `watchlist@v1`           |          | ✓ user   |        |          |        |          |
| `ratings@v1`             |          | ✓ user   |        |          |        |          |
| `recommendations@v1`     |          | ✓ user   |        |          |        |          |
| `calendar@v1`            |          | ✓ user   |        |          |        |          |
| `mediaRequest@v1`        |          |          | ✓ user |          |        |          |
| `userComments@v1`        |          | ✓ user   |        |          |        |          |
| `watchProviders@v1`      | ✓ global |          |        |          |        |          |
| `trailers@v1`            | ✓ global |          |        |          |        |          |
| `playback@v1`            |          | ✓ user   |        |          | ✓ user | ✓ user   |
| `collection@v1`          |          | ✓ user   |        |          |        |          |
| `libraryAvailability@v1` |          |          |        |          | ✓ user | ✓ user   |
| `playbackSessions@v1`    |          |          |        |          | ✓ user | ✓ user   |
| `continueWatching@v1`    |          |          |        |          | ✓ user | ✓ user   |
| `libraryAdmin@v1`        |          |          |        |          | ✓ user | ✓ user   |

## Plugin context

The only surface a plugin can touch outside its own code. Built fresh by the host for every call. The host selects which credentials to inject based on the scope of the capability being invoked and, where relevant, the current rotation pick from a pool.

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
}
```

The plugin does not need to know or decide which side (shared vs user) the current credential came from — after `markExhausted`, the host knows what to mark and what to try next.

What is deliberately not exposed:

- No direct DB access.
- No filesystem.
- No cross-plugin calls. The host resolves `id_map` lookups.
- No `setTimeout` / `setInterval`. Scheduling is host-driven via manifest jobs.
- No env vars. Anything a plugin needs is in `config` or the credential slots.
- No `eval` or dynamic imports. The bundled JS file is everything the plugin gets.
- No visibility into other pool entries. The plugin sees only the current pick.

## Plugin runtime

Host-owned. Nothing else in the app touches the plugin runtime directly.

**v1 layout (trusted TypeScript modules, no sandbox):**

```
server/plugin-runtime/
├── runtime.ts       PluginRuntime — lifecycle, invocation
├── context.ts       PluginContext builder
├── loader.ts        Validate and register built-in modules
├── registry.ts      Capability registry
└── types.ts
```

> **Future revision — QuickJS sandbox:** When third-party plugin support is introduced, `sandbox.ts` (QuickJS instance wrapper via `quickjs-emscripten`) and `host-bridge.ts` (implementations of `ctx` methods crossing the sandbox boundary) will be added. The layout above will expand accordingly, and the per-instance memory cap (64 MB) and call timeout (30 s via QuickJS interrupt handler) will be enforced at that point. Until then, built-in plugins run as trusted TypeScript modules with no memory or timeout isolation.

**Instance model (v1):** one module reference per plugin, registered at host startup. User-scoped data is passed through `ctx` every call; plugins must not stash user state in module scope.

**Invocation path:**

1. `MediaService` asks the registry which plugins implement the requested `(capability, version, scope)` tuple.
2. For each matching plugin: runtime validates input against the capability's input schema.
3. Host builds the credential plan for this call:
   - **Global-scoped call:** pick a `shared_credentials` entry from the admin pool. For `poolable: true` plugins, rotate across enabled entries whose `retry_after` is past (round-robin). For non-poolable plugins, use the single entry or fail with `CAPABILITY_UNAVAILABLE` if none.
   - **User-scoped call:** resolve the user's enabled connections for this plugin. For `poolable: true` plugins, rotate across them; otherwise pick the default. If the plugin's `personalKeyFallback` is `"admin-first"` or `"personal-first"`, the call also has a secondary pool on the other side (always scoped to this user's request — user A's key is never used for user B).
4. Host decrypts the selected credential, builds `PluginContext` with `config.global`, `config.user` (user-scoped only), `credentials`, and/or `sharedCredentials` according to the plan.
5. Host invokes the plugin method.
6. If the plugin calls `ctx.pool.markExhausted({ retryAfterSec })` and throws: host updates the current pool entry's `retry_after`, picks the next entry in the current pool (or falls over to the secondary pool per `personalKeyFallback`), rebuilds `ctx`, and retries the same invocation. Retry count is bounded by the total pool size to prevent loops; exhausting everything surfaces as `POOL_EXHAUSTED`.
7. Runtime validates output against the output schema.
8. Result returned to `MediaService` for fan-out handling.

**`personalKeyFallback` policy (per plugin, admin-configured):**

| Policy             | Primary pool                                                   | Fallback pool                                                                           |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `"off"` (default)  | Context-dependent (admin pool for global, user pool for user)  | None                                                                                    |
| `"admin-first"`    | Admin shared-credentials pool                                  | Requesting user's own connection pool (user-scoped calls only, if user has connections) |
| `"personal-first"` | Requesting user's own connection pool (user-scoped calls only) | Admin shared-credentials pool                                                           |

Only meaningful for plugins with `poolable: true` and at least one user-scoped capability. For pure-global plugins the policy is unused; for non-poolable plugins with user-scoped capabilities the policy still applies (the "pool" is just size-one on the user side).

**Error handling:**

- Plugin throws: host catches, logs with plugin id and stack, updates the relevant connection or pool entry (`status = "error"` on a connection, or `retry_after` on a pool entry) with message, returns a typed error to the caller. Host never crashes.
- Auth-specific errors (expired token, bad credentials) surface via reserved error codes so the host can trigger refresh or mark the connection / shared-credential entry as errored.
- `POOL_EXHAUSTED`: every entry in every relevant pool for this call is in cooldown. Carries the nearest `retryAfterSec`.
- `CAPABILITY_UNAVAILABLE`: no plugin provides `(capability, scope)`, or the only providers have no usable config (e.g. pure-global plugin with no admin shared credentials set).
- _(Future — QuickJS sandbox)_ Sandbox OOM or timeout: runtime reboots the instance on next use; affected connection is marked error until recovery.

**Security enforcement points:**

- `ctx.fetch`: hostname check against `manifest.allowedHosts` unioned with any hostnames resolved from `x-allowed-host` fields in the active `userConfig`/`shared_credentials`; per-plugin token-bucket rate limit.
- `ctx.store`: server-side namespacing by `(plugin_id, user_id, key)`. Plugins never see other plugins' or other users' data.
- `ctx.log`: tagged and filtered by host.
- `ctx.pool.markExhausted` is purely advisory to the host; it cannot be used to leak state across plugins or users.
- Call timeout, memory limit, no dynamic code execution.

**Caching implications:**

- Global-scoped call results are user-independent. Cache keys are `plugin:{plugin_id}:{capability}:{argsHash}`, shared across all users — large saving on TMDB/TVDB metadata.
- User-scoped call results keep the existing `user:{user_id}:{plugin_id}:{capability}:{argsHash}` keys.

## Database schema

### `plugins`

Registry of installed plugins. One row per installed plugin.

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

`global_config` is plaintext by design — it carries display settings, base URLs, feature flags. All admin secrets live in `plugin_shared_credentials` (encrypted).

One version per plugin at a time. Retention: the last 3 version directories stay on disk for rollback.

### `plugin_shared_credentials` (new)

Admin-owned encrypted credentials for a plugin. For `poolable: true` plugins the host rotates across enabled entries with cooldown bookkeeping. For non-poolable plugins exactly one row is permitted per plugin (enforced at insert time).

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

Decrypted values are never returned over the API. Admin UIs use `label` and status telemetry only.

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

**Why `user_config` and `credentials` live in different columns:** they have independent lifecycles. `user_config` is plaintext and low-stakes; `encrypted_credentials` is the secret material with its own IV. A cron token refresh re-encrypts credentials without touching config; editing a Seerr URL rewrites config without touching credentials. Fewer ways to corrupt one while writing the other.

**Rows exist only for plugins with user-scoped capabilities.** A plugin with `auth.kind: "none"` and only global-scoped capabilities never has `service_connections` rows — its whole lifecycle is admin-side.

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

Namespace enforcement is in the host bridge. Nightly sweep prunes expired rows.

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

As in the initial design. Populated opportunistically by the host as capability calls return cross-service IDs.

## Lifecycle

### Install (admin-initiated)

1. Fetch JS from `source_url` (or read from bundled path for built-ins).
2. Compute sha256. If caller provided `expectedChecksum`, compare; mismatch aborts.
3. Boot a throwaway QuickJS instance. Call `getManifest()`. Tear down.
4. Validate manifest against host's Zod schema, including the derived rules in the manifest section (scope consistency, required schemas per plugin shape, etc.).
5. Compatibility: `manifest.sdkVersion` satisfies the host's current SDK semver.
6. Confirm every declared capability exists in the host registry at the declared `(version, scope)`.
7. Confirm the plugin object exports all declared capability methods and job handlers.
8. Write JS to `data/plugins/<plugin_id>/<version>/plugin.js`.
9. Insert `plugins` row (with `personal_key_fallback` defaulting to `'off'`).
10. Register capabilities indexed by `(id, version, scope)`; register jobs with croner.
11. Boot the long-lived runtime instance.

Admin-owned shared credentials are added after install via `plugin.addSharedCredential`. A newly-installed plugin may have no shared credentials yet, in which case global-scoped calls return `CAPABILITY_UNAVAILABLE` until the admin configures one.

Any failure rolls back cleanly. No partial state.

### Update

Runs the full install flow against a new version. On success: tear down old instance, stop old cron jobs, update `plugins` row, retain old `<version>/` directory on disk, boot new instance, register new jobs. On failure, old version stays active.

### Enable / disable

Admin toggles `plugins.enabled`. Runtime tears down the instance, unregisters capabilities and jobs. Existing `service_connections` rows are untouched. `MediaService` returns "plugin disabled" errors for disabled-plugin connections. Re-enabling restores everything.

### Uninstall

Delete `plugins` row (cascade deletes `service_connections` and `plugin_store` rows for this plugin). Delete `data/plugins/<plugin_id>/`. Tear down runtime, unregister capabilities and jobs. Invalidate caches tagged to this plugin.

### Token refresh and other scheduled work

Declared by the plugin in `manifest.jobs`. Host croner fires each job at its schedule and calls the plugin handler.

- **Plugin-global jobs:** handler called once per tick with a plugin-scoped `ctx` (no user credentials).
- **`perConnection: true` jobs:** host iterates every `service_connections` row for the plugin, builds a user-scoped `ctx`, calls the handler per row. Handler returns new credentials (or throws). Host re-encrypts and updates the row. Used for token refresh and health checks.

Putting the iteration in the host keeps plugins simple and consistent.

## API endpoints (oRPC)

### Admin — plugin management

Permission: `admin:plugins`.

**Core lifecycle:**

- `plugin.list` — all installed plugins with manifest, version, enabled, install date, `personalKeyFallback` policy, `poolable`, `sharedCredentialsCount` (enabled entries), and `capabilities: Array<{ id, version, scope }>`. Never includes decrypted secrets.
- `plugin.install` — `{ sourceUrl, expectedChecksum? }` → new plugin row. _(Deferred — requires QuickJS sandbox; see "Deferred to future revisions".)_
- `plugin.update` — `{ pluginId, sourceUrl, expectedChecksum? }` → updated row. _(Deferred — same prerequisite.)_
- `plugin.uninstall` — `{ pluginId }` → full cascade (drops shared credentials, connections, store entries). Built-in plugins cannot be uninstalled.
- `plugin.setEnabled` — `{ pluginId, enabled }`.
- `plugin.rollback` — `{ pluginId, toVersion }`, only versions still on disk. _(Deferred — same prerequisite.)_

**Plaintext global config (admin):**

- `plugin.setGlobalConfig` — `{ pluginId, config }`, validated against `globalConfigSchema`. Stored plaintext.
- `plugin.getGlobalConfig` — returns plaintext global config for the admin UI.

**Shared credentials pool (admin):**

- `plugin.listSharedCredentials` — `{ pluginId }` → array of `{ id, label, enabled, lastExhaustedAt, retryAfter, createdAt, updatedAt }`. Decrypted values are never returned.
- `plugin.addSharedCredential` — `{ pluginId, label, value }`. Value is validated against `sharedCredentialsSchema` and encrypted before write. Rejected if the plugin is not `poolable` and an entry already exists.
- `plugin.updateSharedCredential` — `{ pluginId, credentialId, label?, value?, enabled? }`. Fields omitted in the payload are preserved (merge semantics).
- `plugin.deleteSharedCredential` — `{ pluginId, credentialId }`. No count guard; deleting the last enabled entry simply causes global-scoped calls to return `CAPABILITY_UNAVAILABLE` until another is added.
- `plugin.testSharedCredential` — `{ pluginId, credentialId }` → `{ ok, message? }`. Host builds a runtime `ctx` with that specific credential injected and calls the plugin's `testConnection` (or, for pure-global plugins with `auth.kind: "none"`, a reserved lightweight probe method — alternatively, pure-global plugins can export an optional `verifyShared` handler that the host calls here).

**Fallback policy (admin):**

- `plugin.setPersonalKeyFallback` — `{ pluginId, policy: "off" | "admin-first" | "personal-first" }`. Only meaningful for plugins with any user-scoped capability; rejected for pure-global plugins. Default remains `"off"`.

### User — connection management

Permission: `account:connections`. Scoped to the authenticated user.

**Reads:**

- `connection.list` — user's connections with plugin manifest info merged in. Includes `userConfig` with `x-secret` and `x-private` properties stripped (cards need non-secret, non-private fields for display); never includes credentials.
- `connection.getUserConfig` — `{ connectionId }` → `user_config` with `x-secret` and `x-private` properties stripped (for edit-form prefill). Credentials never returned.
- `plugin.listAvailable` — plugins the user can create a connection for. **Only returns plugins with at least one user-scoped capability.** Each entry includes:
  - `userScopedCapabilities: Array<{ id, version }>` — what a connection unlocks for this user.
  - `globalScopedCapabilities: Array<{ id, version }>` — informational only; already available, no connection required.
  - `poolable: boolean` — drives whether the UI offers an "add another instance" affordance for this plugin.
  - `adminSharedAvailable: boolean` — true when admin has configured at least one enabled shared-credentials entry. The UI uses this to show "metadata already works out of the box" language on mixed plugins.

**Writes — form auth:**

- `connection.create` — `{ pluginId, userConfig, displayName? }`.
- `connection.updateUserConfig` — `{ connectionId, userConfig }`. The host **merges** the incoming payload over the prior decrypted `userConfig` (incoming wins where present), so `x-secret` and `x-private` fields the client omits are preserved. For `auth.kind === "form"`, the host then re-runs `startAuth(ctx, mergedUserConfig)` to validate upstream and produce fresh credentials, and writes both `encrypted_user_config` and `encrypted_credentials` atomically. For other auth kinds, the host runs `testConnection` against existing credentials + merged userConfig and writes only `encrypted_user_config`. On any verification failure, both columns are preserved.
- `connection.updateDisplayName` — cosmetic, no plugin involvement.

**Writes — OAuth redirect:**

- `connection.initiateOAuth` — `{ pluginId }` → `{ redirectUrl, nonce }`.
- Completing the redirect flow. Two approaches are supported; both are valid and can coexist:
  - **SPA / frontend-driven (current implementation):** The OAuth provider redirects back to the frontend. The frontend extracts `code` and `state` from the query string, then calls `connection.completeOAuth` — `{ nonce, queryParams }` → `{ connection }`. This avoids a server-side session cookie requirement and works naturally in a SPA context.
  - **Server-side callback (future, for non-SPA clients):** A regular HTTP handler at `GET /api/oauth/callback/:pluginId` receives the provider redirect directly. The host looks up `state` in `pending_auth`, calls `completeAuth(ctx, queryParams, state)`, encrypts credentials, and redirects the client to a confirmation page. Required for native apps, server-rendered clients, or any context where the frontend cannot intercept the redirect.

**Writes — OAuth device:**

- `connection.initiateDeviceAuth` — `{ pluginId }` → `{ userCode, verifyUrl, nonce, intervalSec, expiresAt }`.
- `connection.pollDeviceAuth` — `{ nonce }` → pending / completed / error.

**Writes — common:**

- `connection.setDefault` — `{ connectionId }`.
- `connection.setEnabled` — `{ connectionId, enabled }`.
- `connection.delete` — auto-promotes another instance to default if needed.
- `connection.test` — `{ connectionId }`. Calls `testConnection(ctx)` on the plugin. Updates `last_verified_at` on success, `status="error"` on fail.

## Shared-credentials behaviour for TMDB / TVDB

The former bespoke "shared-key model" is now just an instance of the general scope + pool system:

- TMDB/TVDB declare `metadata` and `idResolve` as `scope: "global"`. These calls never require a user connection and run entirely off the admin pool in `plugin_shared_credentials`.
- When TMDB/TVDB later expose user-scoped capabilities (watchlist, ratings), those require a user connection with real credentials. Users without a connection still get global capabilities from the admin pool; they just can't sync their personal watchlist.
- The manifest sets `poolable: true` for TMDB/TVDB; admins can configure multiple API keys and the host rotates/fails over automatically.
- `personalKeyFallback` lets the admin decide how admin pool and a user's personal keys interact for user-scoped calls — without ever mixing keys across users.

## Self-hosted network topology

Media-manager, Plex, Jellyfin, and the browser that ultimately opens a deep link often live on three different network vantage points. A typical docker-compose deployment has media-manager reaching Plex at `http://plex:32400` over a private bridge network, while the user's phone reaches the same server at `https://plex.mydomain.com`. The two URLs are not interchangeable, and conflating them breaks silently — the host talks to Plex fine, but every `playerLink` it returns 404s on the client.

The design handles this in three places.

**User-configurable dual URLs on server plugins.** Plex and Jellyfin `userConfigSchema` expose:

- `externalServerUrl` (required, marked `"x-allowed-host": true`) — the URL the client can reach. All `playerLink` / `webLink` values MUST be built from this. Stored plaintext in `user_config`.
- `internalServerUrl` (optional, marked `"x-allowed-host": true` and `"x-private": true`) — the URL the host should prefer for server-to-server `ctx.fetch` calls. Falls back to `externalServerUrl` when unset. The `x-private` annotation is what keeps this value from ever appearing in an API response; the mechanism is defined once in the manifest section and reused here rather than hardcoded for this specific field.

When both are set, the plugin's convention is: **fetch via internal, return external in every field that leaves the server.**

**Dynamic `ctx.fetch` allowlist.** `manifest.allowedHosts` is still the static floor — `plex.tv` for Plex PIN auth, for example. For hosts that cannot be known at manifest time (any user-supplied URL), the runtime unions in the hostname of every `"x-allowed-host": true` field present on the current call's connection (or shared-credentials entry). The allowlist is recomputed per invocation, so rotating to a different connection in a pool reshapes what `ctx.fetch` can reach.

**SSRF mitigation on `x-allowed-host` fields.** Self-hosted deployments require the host to reach private-network addresses (a user's `internalServerUrl: http://plex:32400` is the whole point), so a blanket RFC1918 block would defeat the design. Instead, the runtime applies a narrow blocklist to hostnames resolved from `x-allowed-host` fields before adding them to the per-call allowlist, covering the attack surfaces that have no legitimate reason to be reached from a plugin:

- Cloud instance-metadata endpoints: `169.254.169.254` (AWS / GCP / Azure IMDS), `fd00:ec2::254` (IMDSv6), `100.100.100.200` (Alibaba), and `metadata.google.internal`.
- Loopback ranges: `127.0.0.0/8` and `::1` — legitimate server URLs point to a real host in the network, not to the media-manager process itself.
- Link-local ranges outside the metadata blocklist: `169.254.0.0/16` and `fe80::/10`.

DNS resolution for `x-allowed-host` URLs happens inside the `ctx.fetch` implementation, so the runtime can apply the blocklist to the resolved address (not just the hostname string) and mitigate DNS-rebinding attempts. RFC1918 / ULA / unique-local ranges are deliberately **allowed**, because they are the expected topology for docker-compose and LAN deployments. Admins who deploy in hostile multi-tenant environments can tighten the blocklist via a host-level setting; the default is the list above.

**App-level external URL for OAuth and link-backs.** The media-manager app itself has the same internal-vs-external split. OAuth providers redirect users back to the app, and "open in browser" links in emails or MCP tool outputs must resolve on the client's network. The host reads a single `APP_EXTERNAL_URL` setting (env var, surfaced to admins) and uses it for:

- OAuth `redirect_uri` values the plugin returns from `startAuth` (`${APP_EXTERNAL_URL}/oauth/callback/${plugin_id}`). Plugins never construct this themselves — the runtime injects the base URL via `ctx.appBaseUrl`.
- Any absolute link the host returns in an API response that is expected to be opened by a browser.

`APP_EXTERNAL_URL` is mandatory in production. In dev it defaults to `http://localhost:<port>`. A misconfigured value fails fast: the host validates on startup that it is a well-formed absolute URL, and OAuth providers will reject a redirect URI that does not match their registered value, surfacing the mistake at the first connection attempt rather than silently.

## Preference profiles

Host-owned internal state, not a plugin concern. The rebuild job reads from `watchHistory@v1`, `ratings@v1`, `metadata@v1`, and the `feedback_log` table, then writes to the existing `preference_profiles` table. No new capability.

If a plugin later needs to read the user's profile (e.g. a taste-based recommendations plugin), it will be injected via `ctx.userProfile`, not exposed as a capability. Pluggable scoring algorithms are out of scope for v1.

## Caching

Cache keys are `mv:{capability}:{version}:{method}:{scope_segment}:{args_hash}`, where `{scope_segment}` is `user:{user_id}` for user-scoped calls and `global` otherwise. Connection create/update/delete invalidates relevant per-user cache entries. `CacheProvider` supports in-memory (lru-cache) and optional Redis.

The scope segment comes from the _resolved_ scope of the request, not a capability-level flag. For fixed-scope capabilities (`scope: "global"` or `scope: "user"` on the host definition) this is equivalent to the old rule. For mixed-scope capabilities the dispatcher calls `scopeForInput(input)` once per request and uses the result for both provider lookup and the cache key — so a user-scoped branch of a mixed capability (e.g. `idResolve@v1` with `from: "plex:ratingKey"`) cannot pollute or be served from the global cache. This is what lets `idResolve@v1` serve its cross-service id-types (`tmdb`/`imdb`/`tvdb`/`trakt`) from one shared global entry while keeping server-local resolutions (`plex:ratingKey`/`jellyfin:itemId`) isolated per user.

## Testing

- Every host capability has unit tests with a fake plugin returning fixture data. Covers input/output validation, fan-out, and error paths.
- Every built-in plugin has a contract test: calls each declared capability with a mocked `ctx`, verifies shape and behavior.
- _(Future — QuickJS sandbox)_ Plugin runtime integration tests for the sandbox boundary: fetch allowlist enforcement, memory cap, call timeout, store namespacing.
- _(Future — third-party install)_ Lifecycle tests covering install rollback on each validation failure.

## Migration from the current implementation

The codebase already has a plugin runtime, but with the old capability/credentials shape. Migration is a one-time process:

**Schema:**

1. Add `plugin_shared_credentials` table.
2. For every existing row in `plugins` where `shared_credentials IS NOT NULL`: insert one `plugin_shared_credentials` row with `label: "Primary"`, copying `encrypted_value` and `iv`. Preserves admin-configured keys across the migration.
3. Drop `plugins.shared_credentials` and `plugins.shared_credentials_iv` columns.
4. Add `plugins.personal_key_fallback TEXT NOT NULL DEFAULT 'off'`.
5. Add `service_connections.last_exhausted_at` and `service_connections.retry_after` columns (for user-pool rotation bookkeeping on poolable plugins).

**Manifest shape (stored on `plugins.manifest`):**

Re-parse each stored manifest at migration time and coerce into the new shape:

- `capabilities: Record<string, string>` → `Record<string, { version, scope }>` using a built-in defaults table (e.g. `metadata`/`idResolve` → `global`; `watchHistory`/`watchlist`/`ratings`/`mediaRequest`/`calendar`/`recommendations` → `user`).
- Drop `allowsSharedCredentials` (folded into scope + `personalKeyFallback`).
- Set `poolable` from a built-in defaults map (`tmdb`, `tvdb` → `true`; `trakt`, `seerr` → `false`).

The defaults table lives in migration code, not runtime code.

**Data cleanup — remove empty-credentials rows:**

Current TMDB behavior creates `service_connections` rows with empty `credentials: {}` when a user submits the form without a key. These are nonsense under the new rules. Migration decrypts each TMDB connection's credentials and deletes any row whose plaintext credentials are empty. Users with real personal keys keep their connections unchanged.

**Built-in plugin code updates (out of scope for this doc, but tracked):**

- TMDB `startAuth` no longer produces empty-credentials results; requires a real key or returns `status: "error"`.
- All built-in manifests updated to the new capability shape with explicit `scope`.
- TMDB and TVDB: `poolable: true`. Trakt and Seerr: `poolable: false`.
- References to `ctx.sharedCredentials` stay valid; the injection contract moves from `allowsSharedCredentials` to scope-based selection.

## Deferred to future revisions

The following are explicitly out of scope for v1 and tracked here so they are not forgotten.

### QuickJS WASM sandbox

**What:** Replace the current trusted-TypeScript-module model with a proper QuickJS WASM sandbox (`quickjs-emscripten`) so that third-party plugin code runs isolated from the host process.

**Why deferred:** All current plugins are built-ins that are part of the same codebase and already go through the same review process as host code. The sandboxing complexity is only justified when untrusted third-party code is involved.

**Prerequisites before implementing:**

- `sandbox.ts` — QuickJS instance wrapper; one long-lived instance per plugin, booted on host startup and rebooted on install/update.
- `host-bridge.ts` — implementations of all `ctx.*` methods crossing the sandbox boundary (fetch, log, store, pool).
- Per-instance memory cap enforcement (default 64 MB, configurable per-plugin).
- Per-call timeout (30 s) enforced via QuickJS interrupt handler.
- Sandbox OOM/timeout recovery: runtime reboots the instance on next use; affected connection marked error until recovery.
- All built-in plugins must be compiled to plain JS bundles so they can be loaded into QuickJS identically to third-party plugins.

### Third-party plugin install, update, and rollback

**What:** Admin-initiated lifecycle for plugins sourced from a URL rather than bundled in the codebase.

**Endpoints (deferred):**

- `plugin.install` — `POST /api/plugins` — `{ sourceUrl, expectedChecksum? }`. Fetches JS, computes sha256, boots throwaway QuickJS instance to call `getManifest()`, validates against host schema, writes to `data/plugins/<id>/<version>/plugin.js`, inserts `plugins` row.
- `plugin.update` — `PATCH /api/plugins/:id/source` — `{ sourceUrl, expectedChecksum? }`. Runs full install flow against new version; on success tears down old instance, stops old cron jobs, retains old version directory on disk, boots new instance.
- `plugin.rollback` — `POST /api/plugins/:id/rollback` — `{ toVersion }`. Only versions still on disk (last 3 retained). Swaps back to a prior version directory.

**Why deferred:** All three operations require the QuickJS sandbox to be in place first — they load untrusted JS into a throwaway instance to extract the manifest, and the long-lived runtime instance is a QuickJS instance.

### Server-side OAuth redirect callback

**What:** `GET /api/oauth/callback/:pluginId` — a regular HTTP handler that receives the provider redirect directly (for native apps, server-rendered clients, or any context where the frontend cannot intercept the redirect).

**Current approach:** SPA-driven — the frontend catches the provider redirect, extracts `code` and `state`, and calls `POST /api/connections/oauth/redirect/complete` with `{ nonce, queryParams }`. Both approaches share the same underlying `completeAuth` plugin call and `pending_auth` state resolution; only the transport differs.

**Why deferred:** The SPA path covers all current client use cases. The server-side callback adds complexity (CSRF handling, post-redirect client-notification strategy) that is not justified until a non-SPA client exists.

---

## Open questions / deferred

- **Pool rotation strategy.** v1 ships round-robin. Sticky-per-user, weighted, or quota-aware pickers are future work once telemetry shows uneven distribution or cache-locality wins.
- **Admin pool telemetry dashboards.** The `last_exhausted_at` / `retry_after` columns exist to back this; the UI surface is out of scope for v1.
- **Cross-plugin events.** Deferred until a concrete use case appears.
- **User-installable plugins from an admin allowlist.** Data model leaves room via a future `plugin_allowlist` table; not built in v1.
- **Auto-update of plugins.** Manual only in v1.
- **Marketplace / discovery.** Out of scope.
- **`serverPlaylists@v1`.** CRUD for server-side playlists (Plex `/playlists/*`, Jellyfin `/Playlists/*`). Real value for "add to Friday movie night" flows, but does not feed the home feed directly. Revisit once a concrete consumer appears.
- **`markers@v1` (skip-intro / skip-credits).** Plex exposes this cleanly via `Marker` elements on items; Jellyfin's intro-skip is plugin-only and unstable. Held back until Jellyfin stabilises theirs so it can ship as a cross-server capability rather than Plex-only.

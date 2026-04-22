# Plugin Architecture for Connections

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Supersedes:** Initial Connections design (non-plugin)

## Summary

The connections subsystem is being redesigned so that every service integration (Trakt, Seerr, TMDB, TVDB, and any future third-party service) is implemented as a plugin. Built-in services ship as bundled plugins in the same format as third-party ones. Plugins are single JavaScript files executed in a QuickJS WASM sandbox, with a narrow host-exposed context API for networking, logging, storage, credentials, and config. Capabilities are versioned, schema-validated, and discoverable at runtime, so the host can fan out feature calls (watch history, recommendations, media requests, etc.) to whichever plugins implement them.

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

**Why JSON Schema, not Zod, for config shapes.** Plugins run in QuickJS. Requiring them to bundle Zod is overkill. JSON Schema is inert data, renders on the frontend with a generic renderer (e.g. `@rjsf/core`), and validates server-side with `ajv`. The host's own internal schemas stay Zod — they are host code.

**`x-secret` extension.** Properties marked `"x-secret": true` are treated as secrets by the host and frontend. The frontend renders them as masked inputs and never displays their values on connection cards. The host strips them from `connection.list` and `connection.getUserConfig` responses. On `updateUserConfig`, omitted secret fields are preserved by merging with the prior stored value rather than blanked out. `sharedCredentialsSchema` is implicitly a secret schema — the host never returns decrypted values to any API response.

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
// TMDB — mixed, poolable
globalConfigSchema:      { imageBaseUrl }                // plaintext
sharedCredentialsSchema: { apiKey, oauthClientId? }      // encrypted admin pool
userConfigSchema:        (none)
credentialsSchema:       { accessToken }                 // OAuth token
auth: { kind: "oauth_redirect" }
poolable: true
capabilities: {
  metadata:  { version: "v1", scope: "global" },
  idResolve: { version: "v1", scope: "global" },
  watchlist: { version: "v1", scope: "user"   },         // later
  ratings:   { version: "v1", scope: "user"   },         // later
}

// Trakt — all user-scoped, not poolable (each connection is a distinct account)
auth: { kind: "oauth_device" }
poolable: false
capabilities: {
  watchHistory: { version: "v1", scope: "user" },
  watchlist:    { version: "v1", scope: "user" },
  ratings:      { version: "v1", scope: "user" },
}

// Seerr — all user-scoped, not poolable (each connection is a distinct server)
// A hypothetical pure-global plugin — no credentialsSchema, no userConfigSchema, auth.kind: "none"
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

**`form`** (e.g. Seerr):

1. Frontend collects `userConfig` fields from `userConfigSchema`.
2. Host calls `startAuth(ctx, userConfig)`. Plugin tests the credentials and returns `{ status: "completed", credentials }`.

**`oauth_redirect`** (standard OAuth2):

1. Host calls `startAuth(ctx, null)`. Plugin returns `{ status: "redirect", url, state }`.
2. Host stashes `state` in a `pending_auth` row keyed by a nonce.
3. Frontend redirects user.
4. Provider redirects back to the host callback route. Host looks up `state`, calls `completeAuth(ctx, queryParams, state)`, receives `{ status: "completed", credentials }`.

**`oauth_device`** (e.g. Trakt):

1. Host calls `startAuth(ctx, null)`. Plugin returns `{ status: "display_code", code, verifyUrl, pollState, intervalSec }`.
2. Host returns code + verifyUrl + nonce + intervalSec to the frontend.
3. Frontend displays instructions, polls `connection.pollDeviceAuth(nonce)` at `intervalSec`.
4. Each poll: host calls `pollAuth(ctx, pollState)`. Plugin returns `pending`, `completed`, or `error`.

**`none`**: plugin has no per-user credentials. Only legal for pure-global plugins (every capability has `scope: "global"`). No `service_connections` rows exist for these plugins; they run entirely off admin-owned shared credentials and global config.

On `status: "completed"`, host encrypts the credentials, creates the `service_connections` row, auto-promotes to default if it's the first instance, and returns the connection to the frontend. **Empty-credentials rows are rejected**: if the validated credentials payload for a plugin that declares `credentialsSchema` is missing required fields or resolves to an empty object, the create is refused with a typed error rather than producing a "parked" connection.

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

- Validate input against the capability's Zod input schema before calling the sandbox.
- Validate output against the Zod output schema after the call returns. Bad output throws before reaching `MediaService`.
- Version pinning. A caller asking for `watchHistory@v1` is not matched by a plugin declaring `watchHistory: "v2"`.
- Scope routing. The registry is indexed by `(capability_id, version, scope)`; `MediaService` asks for "who provides X at scope Y" and never mixes the two.

**Versioning policy.** Breaking changes introduce a new version alongside the old. Old plugins keep working until no consumer needs v1, at which point v1 can be removed host-side. No forced upgrades. Scope changes on a capability (global ↔ user) always constitute a breaking change and require a new major version.

**Initial capability set (with canonical scope; plugins may still declare the opposite where it makes sense, e.g. a plugin that exposes `metadata` from a personal library):**

- `metadata@v1` — search, get by id, similar titles, poster URLs. Typically `global`.
- `watchHistory@v1` — get/add history. Output carries `watchedAt`, optional `progress`, optional `rewatchCount`. Typically `user`.
- `watchlist@v1` — get/add/remove watchlist. Typically `user`.
- `ratings@v1` — get/set ratings. Typically `user`.
- `recommendations@v1` — get recommendations. Typically `user` (may accept a `global` variant for anonymous trending).
- `calendar@v1` — upcoming episodes/releases. Typically `user`.
- `mediaRequest@v1` — request media, check availability. Typically `user`.
- `idResolve@v1` — resolve one id type to others; feeds `id_map`. Typically `global`.

New capabilities are added over time as features land.

## Plugin context

The only surface a plugin can touch outside its own code. Built fresh by the host for every call. The host selects which credentials to inject based on the scope of the capability being invoked and, where relevant, the current rotation pick from a pool.

```ts
interface PluginContext<TCred, TSharedCred, TUserCfg, TGlobalCfg> {
  // Networking — only way plugins reach the outside world.
  fetch(url: string, init?: RequestInit): Promise<Response>; // enforces manifest.allowedHosts + per-plugin rate limit

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

Host-owned. Nothing else in the app touches QuickJS directly.

**Layout:**

```
server/plugin-runtime/
├── runtime.ts       PluginRuntime — lifecycle, invocation
├── sandbox.ts       QuickJS instance wrapper (quickjs-emscripten)
├── context.ts       PluginContext builder
├── host-bridge.ts   Implementations of ctx methods
├── loader.ts        Download, validate, store on install
├── registry.ts      Capability registry
└── types.ts
```

**Instance model:** one long-lived QuickJS instance per plugin. Booted on host startup (for enabled plugins), rebooted on install/update. User-scoped data is passed through `ctx` every call; plugins must not stash user state in module scope. Per-instance limits:

- Memory cap (default 64MB, configurable per-plugin in admin).
- Call timeout of 30 seconds via QuickJS interrupt handler.

**Invocation path:**

1. `MediaService` asks the registry which plugins implement the requested `(capability, version, scope)` tuple.
2. For each matching plugin: runtime validates input against the capability's input schema.
3. Host builds the credential plan for this call:
   - **Global-scoped call:** pick a `shared_credentials` entry from the admin pool. For `poolable: true` plugins, rotate across enabled entries whose `retry_after` is past (round-robin). For non-poolable plugins, use the single entry or fail with `CAPABILITY_UNAVAILABLE` if none.
   - **User-scoped call:** resolve the user's enabled connections for this plugin. For `poolable: true` plugins, rotate across them; otherwise pick the default. If the plugin's `personalKeyFallback` is `"admin-first"` or `"personal-first"`, the call also has a secondary pool on the other side (always scoped to this user's request — user A's key is never used for user B).
4. Host decrypts the selected credential, builds `PluginContext` with `config.global`, `config.user` (user-scoped only), `credentials`, and/or `sharedCredentials` according to the plan.
5. Host invokes the plugin method in the QuickJS instance.
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

- Plugin throws inside sandbox: host catches, logs with plugin id and stack, updates the relevant connection or pool entry (`status = "error"` on a connection, or `retry_after` on a pool entry) with message, returns a typed error to the caller. Host never crashes.
- Auth-specific errors (expired token, bad credentials) surface via reserved error codes so the host can trigger refresh or mark the connection / shared-credential entry as errored.
- `POOL_EXHAUSTED`: every entry in every relevant pool for this call is in cooldown. Carries the nearest `retryAfterSec`.
- `CAPABILITY_UNAVAILABLE`: no plugin provides `(capability, scope)`, or the only providers have no usable config (e.g. pure-global plugin with no admin shared credentials set).
- Sandbox OOM or timeout: runtime reboots the instance on next use; affected connection is marked error until recovery.

**Security enforcement points:**

- `ctx.fetch`: hostname check against `manifest.allowedHosts`; per-plugin token-bucket rate limit.
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
- `plugin.install` — `{ sourceUrl, expectedChecksum? }` → new plugin row.
- `plugin.update` — `{ pluginId, sourceUrl, expectedChecksum? }` → updated row.
- `plugin.uninstall` — `{ pluginId }` → full cascade (drops shared credentials, connections, store entries).
- `plugin.setEnabled` — `{ pluginId, enabled }`.
- `plugin.rollback` — `{ pluginId, toVersion }`, only versions still on disk.

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

- `connection.list` — user's connections with plugin manifest info merged in. Includes `userConfig` with `x-secret` properties stripped (cards need non-secret fields for display); never includes credentials.
- `connection.getUserConfig` — `{ connectionId }` → `user_config` with `x-secret` properties stripped (for edit-form prefill). Credentials never returned.
- `plugin.listAvailable` — plugins the user can create a connection for. **Only returns plugins with at least one user-scoped capability.** Each entry includes:
  - `userScopedCapabilities: Array<{ id, version }>` — what a connection unlocks for this user.
  - `globalScopedCapabilities: Array<{ id, version }>` — informational only; already available, no connection required.
  - `poolable: boolean` — drives whether the UI offers an "add another instance" affordance for this plugin.
  - `adminSharedAvailable: boolean` — true when admin has configured at least one enabled shared-credentials entry. The UI uses this to show "metadata already works out of the box" language on mixed plugins.

**Writes — form auth:**

- `connection.create` — `{ pluginId, userConfig, displayName? }`.
- `connection.updateUserConfig` — `{ connectionId, userConfig }`. The host **merges** the incoming payload over the prior decrypted `userConfig` (incoming wins where present), so `x-secret` fields the client omits are preserved. For `auth.kind === "form"`, the host then re-runs `startAuth(ctx, mergedUserConfig)` to validate upstream and produce fresh credentials, and writes both `encrypted_user_config` and `encrypted_credentials` atomically. For other auth kinds, the host runs `testConnection` against existing credentials + merged userConfig and writes only `encrypted_user_config`. On any verification failure, both columns are preserved.
- `connection.updateDisplayName` — cosmetic, no plugin involvement.

**Writes — OAuth redirect:**

- `connection.initiateOAuth` — `{ pluginId }` → `{ redirectUrl, nonce }`.
- Callback route (regular HTTP handler, not oRPC) at `/api/oauth/callback/:pluginId` — completes the flow.

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

## Preference profiles

Host-owned internal state, not a plugin concern. The rebuild job reads from `watchHistory@v1`, `ratings@v1`, `metadata@v1`, and the `feedback_log` table, then writes to the existing `preference_profiles` table. No new capability.

If a plugin later needs to read the user's profile (e.g. a taste-based recommendations plugin), it will be injected via `ctx.userProfile`, not exposed as a capability. Pluggable scoring algorithms are out of scope for v1.

## Caching

Unchanged from the initial design. Cache keys remain `user:{user_id}:{resource}`. Connection create/update/delete invalidates relevant per-user cache entries. `CacheProvider` supports in-memory (lru-cache) and optional Redis.

## Testing

- Every host capability has unit tests with a fake plugin returning fixture data. Covers input/output validation, fan-out, and error paths.
- Every built-in plugin has a contract test: boots in a real QuickJS instance, calls each declared capability with a mocked `ctx`, verifies shape and behavior.
- Plugin runtime has integration tests for the sandbox boundary: fetch allowlist enforcement, memory cap, call timeout, store namespacing.
- Lifecycle tests cover install rollback on each validation failure.

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

## Open questions / deferred

- **Pool rotation strategy.** v1 ships round-robin. Sticky-per-user, weighted, or quota-aware pickers are future work once telemetry shows uneven distribution or cache-locality wins.
- **Admin pool telemetry dashboards.** The `last_exhausted_at` / `retry_after` columns exist to back this; the UI surface is out of scope for v1.
- **Cross-plugin events.** Deferred until a concrete use case appears.
- **User-installable plugins from an admin allowlist.** Data model leaves room via a future `plugin_allowlist` table; not built in v1.
- **Auto-update of plugins.** Manual only in v1.
- **Marketplace / discovery.** Out of scope.

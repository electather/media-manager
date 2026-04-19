# Plugin Architecture for Connections

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Supersedes:** Initial Connections design (non-plugin)

## Summary

The connections subsystem is being redesigned so that every service integration (Trakt, Seerr, TMDB, TVDB, and any future third-party service) is implemented as a plugin. Built-in services ship as bundled plugins in the same format as third-party ones. Plugins are single JavaScript files executed in a QuickJS WASM sandbox, with a narrow host-exposed context API for networking, logging, storage, credentials, and config. Capabilities are versioned, schema-validated, and discoverable at runtime, so the host can fan out feature calls (watch history, recommendations, media requests, etc.) to whichever plugins implement them.

This document is the authoritative spec for the backend design. A later document will cover the frontend.

## Goals

- One abstraction for all service integrations. Built-ins and third-party plugins go through the same interface.
- Plugins are extensible feature-by-feature. New capabilities can be added to the host without breaking existing plugins.
- Plugins are sandboxed. They can only do what the host explicitly grants.
- Typed development for plugin authors via a host-generated `.d.ts` file.
- Multi-instance-per-service support preserved from the initial design.
- Per-user credentials remain encrypted at rest (AES-256-GCM).

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
- The **capability registry** (in-memory, rebuilt on plugin install/update/disable) maps `(capability, version)` to a list of plugins that implement it.
- `MediaService` resolves the user's default connection per plugin, asks the registry which plugins provide a requested capability, and dispatches calls through the runtime.
- **Connections** are bound to plugins by `plugin_id`, not a hardcoded service enum.

Carried over from the initial design unchanged:

- AES-256-GCM encryption with per-user derived keys.
- `id_map` table for cross-service ID resolution, populated opportunistically.
- `account:connections` permission, per-user scope (admins cannot edit other users' connections).
- Multi-instance per service type with a default-instance.
- Connections can be disabled without removal.

Removed:

- The `service` enum (`"trakt" | "tmdb" | "seerr" | "tvdb"`) on `service_connections`. Replaced by `plugin_id`.
- The `integrations/` folder structure. Each former integration becomes a bundled plugin.

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

  // Config shapes — JSON Schema, rendered as forms by the frontend
  globalConfigSchema?: JSONSchema; // admin-set (e.g. OAuth client_id/secret)
  userConfigSchema?: JSONSchema; // user-set (e.g. Seerr base_url + api_key)
  credentialsSchema: JSONSchema; // shape of what gets stored after auth

  // Auth ceremony
  auth: { kind: "form" | "oauth_redirect" | "oauth_device" | "none" };

  // Capabilities implemented (id -> version)
  capabilities: Record<string, string>; // e.g. { watchHistory: "v1" }

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

**`sdkVersion` is a hard compatibility gate.** Install fails fast with a clear error when a plugin targets an incompatible SDK.

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

  // Capability implementations (keys must match manifest.capabilities)
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

`testConnection(ctx)` is required for any plugin with `auth.kind !== "none"`. It is called by the UI's "test" button, the health-check cron, and as a pre-commit check during `connection.updateUserConfig`.

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

**`none`**: plugin has no credentials. `testConnection` is not required. Example: a pure metadata enrichment plugin that only uses global config.

On `status: "completed"`, host encrypts the credentials, creates the `service_connections` row, auto-promotes to default if it's the first instance, and returns the connection to the frontend.

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

**Versioning policy.** Breaking changes introduce a new version alongside the old. Old plugins keep working until no consumer needs v1, at which point v1 can be removed host-side. No forced upgrades.

**Initial capability set:**

- `metadata@v1` — search, get by id, similar titles, poster URLs.
- `watchHistory@v1` — get/add history. Output should carry `watchedAt`, optional `progress`, optional `rewatchCount` so preference profiling has rich signals without needing a v2.
- `watchlist@v1` — get/add/remove watchlist.
- `ratings@v1` — get/set ratings.
- `recommendations@v1` — get recommendations.
- `calendar@v1` — upcoming episodes/releases.
- `mediaRequest@v1` — request media, check availability.
- `idResolve@v1` — resolve one id type to others; feeds `id_map`.

New capabilities are added over time as features land.

## Plugin context

The only surface a plugin can touch outside its own code. Built fresh by the host for every call.

```ts
interface PluginContext<TCred, TUserCfg, TGlobalCfg> {
  // Networking — only way plugins reach the outside world
  fetch(url: string, init?: RequestInit): Promise<Response>; // enforces manifest.allowedHosts + per-plugin rate limit

  // Logging — tagged with plugin id, host-controlled level
  log: { debug: Fn; info: Fn; warn: Fn; error: Fn };

  // Credentials — decrypted by host, injected per call
  credentials: TCred;

  // Config — admin-set global + user's per-instance
  config: { global: TGlobalCfg; user: TUserCfg };

  // Plugin-scoped KV store (backed by plugin_store table)
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

What is deliberately not exposed:

- No direct DB access.
- No filesystem.
- No cross-plugin calls. The host resolves `id_map` lookups.
- No `setTimeout` / `setInterval`. Scheduling is host-driven via manifest jobs.
- No env vars. Anything a plugin needs is in `config`.
- No `eval` or dynamic imports. The bundled JS file is everything the plugin gets.

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

1. `MediaService` asks the registry which plugins implement the requested capability/version.
2. For each matching plugin: runtime validates input against the capability's input schema.
3. Host resolves the user's connection for that plugin, decrypts credentials.
4. Host builds `PluginContext`.
5. Host invokes the plugin method in the QuickJS instance.
6. Runtime validates output against the output schema.
7. Result returned to `MediaService` for fan-out handling.

**Security enforcement points:**

- `ctx.fetch`: hostname check against `manifest.allowedHosts`; per-plugin token-bucket rate limit.
- `ctx.store`: server-side namespacing by `(plugin_id, user_id, key)`. Plugins never see other plugins' or other users' data.
- `ctx.log`: tagged and filtered by host.
- Call timeout, memory limit, no dynamic code execution.

**Error handling:**

- Plugin throws inside sandbox: host catches, logs with plugin id and stack, updates connection `status = "error"` with message, returns a typed error to the caller. Host never crashes.
- Auth-specific errors (expired token, bad credentials) surface via reserved error codes so the host can trigger refresh or mark the connection expired.
- Sandbox OOM or timeout: runtime reboots the instance on next use; connection is marked error until recovery.

## Database schema

### `plugins`

Registry of installed plugins. One row per installed plugin.

```
plugins
├── id                  text PK                           (matches manifest.id)
├── version             text NOT NULL                     (semver)
├── source_url          text NOT NULL                     (where JS was fetched)
├── source_type         text NOT NULL                     ("builtin" | "url")
├── checksum            text NOT NULL                     (sha256 of plugin.js)
├── manifest            text NOT NULL                     (full manifest JSON)
├── enabled             integer NOT NULL DEFAULT 1
├── global_config       text                              (encrypted, nullable)
├── global_config_iv    text
├── installed_by        text FK → user.id
├── installed_at        integer NOT NULL
├── updated_at          integer NOT NULL
```

One version per plugin at a time. Retention: the last 3 version directories stay on disk for rollback.

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
├── encrypted_user_config    text                             [renamed for clarity]
├── user_config_iv           text
├── encrypted_credentials    text NOT NULL                    [now a separate blob]
├── credentials_iv           text NOT NULL
├── token_expires_at         integer
├── last_verified_at         integer
├── error_message            text
├── created_at               integer NOT NULL
├── updated_at               integer NOT NULL
├── INDEX(user_id, plugin_id)
```

**Why `user_config` and `credentials` are separate blobs:** they have independent lifecycles. Editing a Seerr URL re-encrypts `user_config` only; a cron token refresh re-encrypts `credentials` only. Fewer ways to corrupt one while writing the other.

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
4. Validate manifest against host's Zod schema.
5. Compatibility: `manifest.sdkVersion` satisfies the host's current SDK semver.
6. Confirm every declared capability exists in the host registry at the declared version.
7. Confirm the plugin object exports all declared capability methods and job handlers.
8. Write JS to `data/plugins/<plugin_id>/<version>/plugin.js`.
9. Insert `plugins` row.
10. Register capabilities, register jobs with croner.
11. Boot the long-lived runtime instance.

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

- `plugin.list` — all installed plugins with manifest, version, enabled, install date. No decryption.
- `plugin.install` — `{ sourceUrl, expectedChecksum? }` → new plugin row.
- `plugin.update` — `{ pluginId, sourceUrl, expectedChecksum? }` → updated row.
- `plugin.uninstall` — `{ pluginId }` → full cascade.
- `plugin.setEnabled` — `{ pluginId, enabled }`.
- `plugin.setGlobalConfig` — `{ pluginId, config }`, validated against `globalConfigSchema`, encrypted.
- `plugin.getGlobalConfig` — returns decrypted global config for the admin UI.
- `plugin.rollback` — `{ pluginId, toVersion }`, only versions still on disk.

### User — connection management

Permission: `account:connections`. Scoped to the authenticated user.

**Reads:**

- `connection.list` — user's connections with plugin manifest info merged in. No credentials, no user_config.
- `connection.getUserConfig` — `{ connectionId }` → decrypted user_config (for edit forms). Credentials never returned.
- `plugin.listAvailable` — plugins the user can create a connection for. Includes `hasSharedConfig: boolean` for the shared-key fallback model.

**Writes — form auth:**

- `connection.create` — `{ pluginId, userConfig, displayName? }`.
- `connection.updateUserConfig` — `{ connectionId, userConfig }`. Runs `testConnection` before committing; on fail, old config preserved.
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

## Shared-key model (TMDB, TVDB)

Under the plugin model, the "server-wide shared key" becomes the plugin's **`global_config`**. The plugin's capability methods check `ctx.config.user` first, fall back to `ctx.config.global`. When a user has no personal connection, `MediaService` still invokes the plugin with an empty user_config, and the plugin falls back to global config automatically. The UI shows "Using server's shared key" when `hasSharedConfig` is true and the user has no personal connection.

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

## Open questions / deferred

- **Cross-plugin events.** Deferred until a concrete use case appears.
- **User-installable plugins from an admin allowlist.** Data model leaves room for this via a future `plugin_allowlist` table; not built in v1.
- **Auto-update of plugins.** Manual only in v1.
- **Marketplace / discovery.** Out of scope.

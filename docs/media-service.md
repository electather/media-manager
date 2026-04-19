# MediaService and the TMDB Plugin

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-frontend-connections-design.md`
**Revises:** Adds `sharedCredentials` concept to the plugin architecture spec (see §10)

## Summary

This document designs `MediaService` — the facade the rest of the application calls to use plugin-provided capabilities — and the TMDB built-in plugin, which is the first real end-to-end capability implementation. Building these two together forces every abstraction in the plugin architecture doc to produce concrete code, and shakes out questions that can't be answered on paper: how fan-out actually dispatches, how caching keys compose, what error propagation looks like across the sandbox boundary, and how shared-credential plugins slot into the connection model.

The scope here is intentionally narrow: `metadata@v1` only, one plugin (TMDB). Once this works end-to-end, subsequent plugins (Trakt, Seerr, TVDB) follow the same pattern with different auth and capabilities.

## Goals

- Ship `MediaService` as the sole surface the rest of the app uses for any plugin-backed feature.
- Ship the TMDB plugin as the reference implementation for `metadata@v1` and the shared-credentials pattern.
- Define the capability dispatch strategy system concretely, not as a hand-wave.
- Formalize caching, error handling, and `id_map` population as part of `MediaService` behavior.
- Formalize the SDK type bundle and error code vocabulary.

## Non-goals

- Trakt, Seerr, TVDB plugins. They reuse this pattern in follow-up specs.
- Additional capabilities beyond `metadata@v1`.
- MCP tool integration with `MediaService`. Done later.
- `oRPC procedures that consume `MediaService`. The procedures that drive the Connections page (from the plugin architecture doc) are already specified there. Feature-level procedures (e.g. "get media details for this tmdb_id") are out of scope here.

## Architecture

```
                 ┌─────────────────────────────────────┐
                 │  Caller (oRPC procedure, MCP tool,  │
                 │  job, anything host-side)           │
                 └─────────────────┬───────────────────┘
                                   │
                                   ▼
                 ┌─────────────────────────────────────┐
                 │            MediaService             │
                 │  • resolveStrategy(capability)      │
                 │  • resolveConnections(user, plugin) │
                 │  • cache get/set                    │
                 │  • dispatch → runtime               │
                 │  • merge / error aggregate          │
                 │  • id_map harvest                   │
                 └───┬─────────────────────────────┬───┘
                     │                             │
                     ▼                             ▼
          ┌──────────────────┐          ┌──────────────────┐
          │  Capability      │          │ Plugin Runtime   │
          │  Registry        │          │ (QuickJS)        │
          │  (from plugin    │          │ (from plugin     │
          │   architecture)  │          │  architecture)   │
          └──────────────────┘          └──────────────────┘
```

`MediaService` is the only component with knowledge of both the capability strategy layer and the plugin dispatch layer. Callers never touch the registry or the runtime directly.

## `MediaService` surface

```ts
class MediaService {
  // Capability calls — one method per capability+method pair
  getMetadata(userId: string, id: MediaId): Promise<MediaItem | null>;
  searchMetadata(userId: string, query: string, opts?: SearchOpts): Promise<MediaItem[]>;
  getSimilar(userId: string, id: MediaId): Promise<MediaItem[]>;
  // ... future capability methods

  // Health/ops — used by jobs and admin tooling
  testConnection(connectionId: string): Promise<TestResult>;
  invalidateUserCache(userId: string, scope?: CacheScope): Promise<void>;
}
```

The facade is thin. Each method does this:

1. Look up the capability strategy in the registry.
2. Build a cache key from capability + method + args + (user id if user-scoped).
3. Cache hit → return.
4. Cache miss → resolve matching connections (which plugins, which credentials).
5. Dispatch to the runtime per the strategy (single / aggregate / primary_with_enrichment).
6. Harvest `id_map` entries from successful responses.
7. Store merged result in cache with the capability's TTL.
8. Return.

Adding a new capability later means adding one method here, one strategy declaration, and whatever per-method logic its strategy implies. No new dispatch pipeline.

## Capability strategies

Each capability declares its dispatch strategy when defined host-side. `MediaService` reads the strategy from the capability registry and dispatches accordingly.

```ts
type Strategy =
  | "single" // route to one connection; fail means total fail
  | "aggregate" // call all, merge results (union semantics)
  | "primary_with_enrichment"; // user picks primary; others fill null fields

export const MetadataV1 = defineCapability({
  id: "metadata",
  version: "v1",
  strategy: "primary_with_enrichment",
  defaultCacheTtlSec: 60 * 60 * 24, // 24h
  methods: {
    getById: {
      input: z.object({ tmdb_id: z.string(), media_type: MediaTypeEnum }),
      output: MediaItemSchema.nullable(),
    },
    search: {
      input: z.object({ query: z.string().min(1), limit: z.number().optional() }),
      output: z.array(MediaItemSchema),
    },
    getSimilar: {
      input: z.object({ tmdb_id: z.string(), media_type: MediaTypeEnum }),
      output: z.array(MediaItemSchema),
    },
  },
});
```

Initial strategy assignments:

| Capability           | Strategy                  | Rationale                                                        |
| -------------------- | ------------------------- | ---------------------------------------------------------------- |
| `metadata@v1`        | `primary_with_enrichment` | User picks primary per media type; others fill gaps              |
| `watchHistory@v1`    | `aggregate`               | Merge history from all trackers                                  |
| `watchlist@v1`       | `aggregate`               | Union of all watchlists                                          |
| `ratings@v1`         | `aggregate`               | Union, most recent wins per item                                 |
| `recommendations@v1` | `aggregate`               | Merge and dedupe by tmdb_id                                      |
| `calendar@v1`        | `aggregate`               | Merge upcoming from all sources                                  |
| `mediaRequest@v1`    | `single`                  | Routed to user's default Seerr-like connection                   |
| `idResolve@v1`       | Internal                  | Called opportunistically by `MediaService` to fill `id_map` gaps |

Strategy is a capability-level property, not per-method. If a capability has methods that disagree on strategy, it's really two capabilities and should be split.

### Strategy dispatch semantics

**`single`:**

- Resolves exactly one connection (the user's default for that plugin, or the single plugin with that capability if only one implements it).
- If no connection resolves, call returns empty (for read) or throws `NoConnectionError` (for write/request).
- Plugin failure is operation failure. No fan-out, no retry across plugins.
- Plugin-level retry on transient errors still applies (per Q3).

**`aggregate`:**

- Resolves all connections the user has that match the capability, across all plugins.
- Fans out in parallel with a per-call timeout (default 15s, configurable per capability).
- Each result is one of: success, permanent error, transient error (after retry), timeout.
- Merge is array union with capability-specific dedupe logic. For watch history: dedupe by `(tmdb_id, watched_at)`. For watchlist: dedupe by `tmdb_id`. Capability definition provides the dedupe key function.
- Failed calls update the connection's `status` field per Q3 rules; they don't poison the aggregate result.
- Response to caller includes: merged data + `errors: Array<{ connectionId, pluginId, code, message }>`. Caller decides how to present (Connections page still shows the real error source via status).

**`primary_with_enrichment`:**

- User designates a primary connection per dimension (for metadata: per media type). Stored in `user_preferences` table.
- Primary result is the base. Enrichment plugins fill fields where the primary returned null or missing.
- Enrichment order: stable by plugin install date.
- Primary failure: the whole operation returns enrichment-only data. Caller treats this like an `aggregate` partial result.
- All plugin failures update connection `status` per Q3.

### Per-capability cache TTL table

Capability definitions declare `defaultCacheTtlSec`. Admin can override per-capability from `/admin/plugins` (future UI; default values ship sensible):

| Capability           | Default TTL | Notes                           |
| -------------------- | ----------- | ------------------------------- |
| `metadata@v1`        | 24h         | Titles and overviews are stable |
| `watchHistory@v1`    | 5 min       | User expects near-real-time     |
| `watchlist@v1`       | 5 min       | Same                            |
| `ratings@v1`         | 15 min      |                                 |
| `recommendations@v1` | 6h          |                                 |
| `calendar@v1`        | 1h          | Provider-side schedule updates  |

## Caching

### Location

`MediaService` level only. Plugins do not cache responses — `ctx.store` stays for plugin-internal state (cursors, pagination tokens, anything plugin-specific). Defense in depth is YAGNI.

### Key composition

Cache key is a canonicalized string:

```
mv:{capability}:{version}:{method}:{scope}:{argsHash}
```

- `scope` is `global` for capabilities where the output is user-independent (metadata), `user:{userId}` for user-scoped capabilities (watchHistory).
- `argsHash` is `sha256(JSON.stringify(canonicalize(input)))` truncated to 16 hex chars. Canonicalization = sort object keys recursively.
- Capability-level `scope` is declared in the capability definition (`userScoped: boolean`).

### Backend

`CacheProvider` interface from the original connections doc carries forward:

```ts
interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}
```

Two implementations ship:

- `LruCacheProvider` — in-process, default for single-instance deployments.
- `RedisCacheProvider` — shared, for multi-instance.

Config selects via env (`CACHE_BACKEND=lru|redis`, `REDIS_URL=...`).

### Invalidation

- Writes that mutate state (e.g. `addToHistory`) call `cache.deleteByPrefix("mv:watchHistory:v1:*:user:{userId}:*")` after success.
- Each mutating capability method declares its invalidation prefix pattern.
- Connection changes (create, update, delete, enable, disable) invalidate all caches scoped to that user for affected capabilities. This runs via an event the connections layer emits; `MediaService` subscribes.

### Negative caching

Null results (metadata lookup for nonexistent tmdb_id) are cached for a shorter TTL (default 5 min) to prevent hammering external APIs for bad inputs. Errors are not cached.

## Error handling

Plugins return errors as structured data, not thrown exceptions crossing the sandbox. Exceptions inside QuickJS are caught by the runtime and converted to error objects.

### Error code vocabulary

A fixed set of reserved codes that plugins return via `{ status: "error", code, message }`:

```ts
type PluginErrorCode =
  | "token_expired" // OAuth access token expired; trigger refresh
  | "bad_credentials" // Credentials are invalid; connection → "error"
  | "rate_limited" // External API rate limit hit; retry with backoff
  | "transient_network" // Network failure or 5xx; retry once
  | "not_found" // Resource doesn't exist; null result, not an error in aggregate
  | "bad_input" // Caller-side input error; surface as is
  | "internal"; // Plugin-side bug or unexpected state
```

Host behavior by code:

| Code                | Retry?                                    | Update connection status?         | Propagate to caller?                       |
| ------------------- | ----------------------------------------- | --------------------------------- | ------------------------------------------ |
| `token_expired`     | Trigger refresh, retry once               | → `expired` only if refresh fails | If final failure                           |
| `bad_credentials`   | No                                        | → `error` with message            | Yes                                        |
| `rate_limited`      | Yes, with Retry-After or 2s backoff, once | No                                | If retry fails                             |
| `transient_network` | Yes, 1s backoff, once                     | No                                | If retry fails                             |
| `not_found`         | No                                        | No                                | As null for `single`, skipped in aggregate |
| `bad_input`         | No                                        | No                                | Yes                                        |
| `internal`          | No                                        | → `error` with message            | Yes                                        |

### Timeouts

Per-call timeout default 15s, overridable per capability in its definition. Timeout is treated as `transient_network` for retry/status purposes.

### Partial failure in aggregate strategies

Response shape when any plugin fails in `aggregate` or `primary_with_enrichment`:

```ts
interface AggregateResult<T> {
  data: T;
  errors: Array<{
    connectionId: string;
    pluginId: string;
    code: PluginErrorCode;
    message: string;
  }>;
}
```

Caller (oRPC procedure) passes both fields to the frontend. UI decides presentation — typically show data, show a subtle "Some sources unavailable" indicator tied to connection status on `/connections`.

For `single` strategy, failures surface as thrown errors with the same shape on a typed error class (`PluginCallError`).

## `id_map` population

Two complementary paths populate `id_map`:

### Opportunistic (path B)

Every capability method that returns media items includes an optional `ids` field in its output schema:

```ts
const MediaItemSchema = z.object({
  tmdb_id: z.string(),
  media_type: MediaTypeEnum,
  title: z.string(),
  // ... other fields
  ids: z
    .object({
      imdb_id: z.string().optional(),
      tvdb_id: z.string().optional(),
      trakt_id: z.string().optional(),
      trakt_slug: z.string().optional(),
    })
    .optional(),
});
```

After a successful call, `MediaService` walks response items, extracts `ids`, and upserts into `id_map` via the `idResolver` module. Plugin authors get `id_map` population as a side effect of populating the response shape.

### Explicit gap-fill (path C)

When `MediaService` has a `tmdb_id` but needs another ID type (e.g. about to call a Trakt plugin that needs `trakt_slug`), it:

1. Checks `id_map` for existing mapping.
2. On miss, looks for plugins declaring `idResolve@v1` and calls the first matching plugin.
3. Caches the result via opportunistic write.

`idResolve@v1` is an internal-use capability — not called directly by features. Kept as a separate capability so plugins can opt in.

### Conflict resolution (path C with first-writer for imdb_id)

Ownership mapping declared alongside capability registry:

```ts
export const ID_OWNERSHIP: Record<IdField, string | "first_writer"> = {
  tmdb_id: "tmdb",
  tvdb_id: "tvdb",
  trakt_id: "trakt",
  trakt_slug: "trakt",
  imdb_id: "first_writer",
};
```

Upsert rules:

- If field owner is a specific plugin id: only writes from that plugin overwrite. Other plugins' contributions to that field are ignored.
- If field owner is `first_writer`: first non-null write wins, subsequent contradictory writes are logged (debug level) and ignored.
- When a field's owner plugin is not installed, any plugin's contribution populates that field via first-writer semantics (fallback to avoid empty maps).

`idResolver` is a host-internal module exposed only to `MediaService`. Plugins never access it directly.

## Connection resolution

`MediaService.resolveConnections(userId, pluginId): ResolvedConnection[]` returns:

```ts
type ResolvedConnection =
  | { kind: "user"; connection: ServiceConnection; credentials: TCred; userConfig: TUserCfg }
  | { kind: "shared"; plugin: Plugin; credentials: TCred };
```

Resolution order:

1. If the user has enabled personal connections for this plugin: return all of them as `kind: "user"`. Multiple instances (e.g. two Seerr servers) return as multiple entries.
2. Else if the plugin declares `allowsSharedCredentials: true` AND the admin has set shared credentials: return a single `kind: "shared"` entry.
3. Else return empty.

For `single` strategy, `MediaService` picks the default instance from `kind: "user"` results, or the `kind: "shared"` entry, or throws.

For `aggregate`, all entries are dispatched in parallel.

Plugin methods don't know or care whether credentials came from personal or shared. `ctx.credentials` is uniformly populated by the host.

## Runtime dispatch path — detailed

For each plugin call, the runtime does:

1. Input validation against the capability input schema (Zod). Fail fast with `bad_input`.
2. Build `PluginContext`:
   - `fetch` wrapper with `manifest.allowedHosts` check and rate-limit enforcement.
   - `log` tagged with plugin id and optional user id.
   - `credentials` from resolved connection.
   - `config.global` from `plugins.global_config`.
   - `config.user` from the specific `service_connections` row (empty for `kind: "shared"`).
   - `store` namespaced to `(plugin_id, user_id)`.
3. Invoke the capability method in the long-lived QuickJS instance with 15s interrupt timer (or capability-specific override).
4. Catch thrown exceptions, normalize to `{ status: "error", code: "internal", message }`.
5. Apply retry rules per Q3 for `rate_limited` / `transient_network`.
6. Validate output against capability output schema. Schema mismatch becomes `internal` error.
7. Return normalized result to `MediaService`.

## The TMDB plugin

Reference implementation, bundled as a built-in. Ships in `server/plugins/builtin/tmdb/`.

### Manifest

```ts
{
  id: "tmdb",
  name: "The Movie Database",
  version: "1.0.0",
  description: "Movie and TV metadata from The Movie Database",
  logoUrl: "https://www.themoviedb.org/assets/2/v4/logos/...",  // optional, served via host proxy in UI
  author: { name: "your-app", url: "https://..." },
  homepage: "https://www.themoviedb.org/",

  sdkVersion: "^1.0.0",
  allowedHosts: ["api.themoviedb.org", "image.tmdb.org"],

  // Admin-only settings; not credential fallback
  globalConfigSchema: {
    type: "object",
    properties: {
      imageBaseUrl: {
        type: "string",
        format: "uri",
        title: "Image base URL",
        description: "Override the default TMDB image CDN if needed.",
        default: "https://image.tmdb.org/t/p/",
      },
    },
    required: [],
  },

  // Per-user config — user-set API key for personal quota
  userConfigSchema: {
    type: "object",
    properties: {
      api_key: {
        type: "string",
        title: "API Key",
        description: "Your personal TMDB API key (v3 auth).",
        "x-secret": true,
      },
    },
    required: ["api_key"],
  },

  credentialsSchema: {
    type: "object",
    properties: { api_key: { type: "string" } },
    required: ["api_key"],
  },

  allowsSharedCredentials: true,  // admin can set a shared API key

  auth: { kind: "form" },

  capabilities: { metadata: "v1" },

  jobs: [
    { id: "healthCheck", schedule: "0 */6 * * *", handler: "healthCheck", perConnection: true },
  ],
}
```

### `userConfigSchema` vs `credentialsSchema` for TMDB

For form-auth plugins, the userConfig and credentials schemas often look identical — user types an API key, it becomes the credential. `startAuth` for TMDB is:

```ts
startAuth: async (ctx, input: { api_key: string }) => {
  const res = await ctx.fetch(
    `https://api.themoviedb.org/3/authentication?api_key=${input.api_key}`,
  );
  if (!res.ok) {
    return { status: "error", code: "bad_credentials", message: "Invalid API key" };
  }
  return {
    status: "completed",
    credentials: { api_key: input.api_key },
  };
};
```

The form field shows up once; the same value is stored in both encrypted blobs. That's fine — they have different lifecycles even when values match at creation (user might rotate their API key via edit, which updates both).

### Auth flow

Per §6 of the plugin architecture doc:

- `authKind: "form"` → user fills API key, host calls `startAuth`, plugin tests against TMDB `/authentication` endpoint, returns `{ status: "completed", credentials }`.
- `testConnection(ctx)` hits the same endpoint with stored credentials.

No `refreshAuth` needed (API keys don't expire).

### `metadata@v1` implementation

```ts
capabilities: {
  metadata: {
    getById: async (ctx, { tmdb_id, media_type }) => {
      const path = media_type === "movie" ? `/movie/${tmdb_id}` : `/tv/${tmdb_id}`;
      const res = await ctx.fetch(
        `https://api.themoviedb.org/3${path}?api_key=${ctx.credentials.api_key}&append_to_response=external_ids`,
      );
      if (res.status === 404) return null;
      if (res.status === 429) {
        return { status: "error", code: "rate_limited", message: "TMDB rate limit" };
      }
      if (!res.ok) {
        return { status: "error", code: "transient_network", message: `TMDB ${res.status}` };
      }
      const raw = await res.json();
      return mapMovieOrTv(raw, media_type, ctx.config.global.imageBaseUrl);
    },

    search: async (ctx, { query, limit = 20 }) => { /* similar */ },
    getSimilar: async (ctx, { tmdb_id, media_type }) => { /* similar */ },
  },
},
```

`mapMovieOrTv` is a plugin-internal helper that maps TMDB's response shape to `MediaItemSchema`, including `ids.imdb_id` from the `external_ids` sub-response for opportunistic `id_map` population.

### Health check job

Runs every 6 hours per connection:

```ts
jobs: {
  healthCheck: async (ctx) => {
    const res = await ctx.fetch(
      `https://api.themoviedb.org/3/authentication?api_key=${ctx.credentials.api_key}`,
    );
    if (!res.ok) {
      return { status: "error", code: "bad_credentials", message: `TMDB returned ${res.status}` };
    }
    return { status: "ok" };
  },
},
```

Host updates `last_verified_at` on ok, sets `status="error"` on `bad_credentials`.

## Schema revision: `shared_credentials`

Adds to the `plugins` table from the plugin architecture doc:

```
plugins
  ...
├── shared_credentials          text           (encrypted, nullable)
├── shared_credentials_iv       text           (nullable)
```

`allowsSharedCredentials: boolean` is a new manifest field. When true:

- Admin UI shows a "Shared credentials" section in the plugin config modal, rendered from `credentialsSchema`.
- `plugin.setSharedCredentials` admin endpoint writes encrypted blob + iv.
- `plugin.listAvailable` returns `hasSharedConfig: boolean` based on whether this field is populated (supersedes the earlier "global_config populated" check).

`globalConfig` reverts to its pure meaning: admin-only settings plugins see in `ctx.config.global`, never credential fallback.

## SDK delivery

### At v1: raw `.d.ts` in the repo

- File: `sdk/plugin-sdk.d.ts` at the root of the host repo.
- Generated from Zod schemas via `pnpm gen:sdk` (build script).
- Committed to git. CI enforces no drift: running `pnpm gen:sdk` in CI must produce no diff.
- Plugin authors copy the file next to their plugin source, reference via `/// <reference path="./sdk.d.ts" />` or `import type`. Docs in `sdk/README.md` explain this.
- Updates: authors re-download when host ships a new SDK version.

### Future: GitHub releases

Once the SDK shape stabilizes (no breaking changes across ~3 plugin releases), cut a v1.0 release with the `.d.ts` as a release asset. Authors can pin to a release tag and update deliberately.

### What the SDK contains

Types only. No runtime code. Keeps the plugin bundle minimal — nothing from the SDK bloats the QuickJS-loaded JS.

```ts
// sdk/plugin-sdk.d.ts (generated)

export interface PluginManifest { /* ... */ }
export interface PluginContext<TCred, TUserCfg, TGlobalCfg> { /* ... */ }

// Reserved error code vocabulary
export type PluginErrorCode =
  | "token_expired" | "bad_credentials" | "rate_limited"
  | "transient_network" | "not_found" | "bad_input" | "internal";

// Capability interfaces, generated from host Zod schemas
export interface MetadataV1Methods {
  getById(ctx: PluginContext<...>, input: MetadataGetByIdInput): Promise<MetadataGetByIdOutput>;
  search(ctx: PluginContext<...>, input: MetadataSearchInput): Promise<MetadataSearchOutput>;
  getSimilar(ctx: PluginContext<...>, input: MetadataGetSimilarInput): Promise<MetadataGetSimilarOutput>;
}
// ... other capabilities

// Domain types
export interface MediaItem { /* ... */ }
export type MediaType = "movie" | "tv";

// Status payload unions
export type StartAuthResult<TCred> =
  | { status: "completed"; credentials: TCred }
  | { status: "redirect"; url: string; state: string }
  | { status: "display_code"; code: string; verifyUrl: string; pollState: string; intervalSec: number }
  | { status: "error"; code: PluginErrorCode; message: string };
// ... pollAuth, completeAuth, etc.

// Plugin shape and definePlugin helper's inferred type
export interface Plugin<TManifest extends PluginManifest> { /* ... */ }
export function definePlugin<TCred, TUserCfg, TGlobalCfg>(
  plugin: PluginDefinition<TCred, TUserCfg, TGlobalCfg>,
): PluginDefinition<TCred, TUserCfg, TGlobalCfg>;
```

`definePlugin` is the only "runtime" symbol — and it's identity at runtime, pure types at compile time. The .d.ts declares the function signature; the plugin file itself provides a trivial implementation:

```js
// sdk/plugin-sdk.js — optional companion file for authors who want runtime
export const definePlugin = (p) => p;
```

Authors can either import this file or paste the one-liner into their plugin. Both paths work.

## Layout

```
server/
├── plugins/
│   └── builtin/
│       └── tmdb/
│           ├── plugin.js          # bundled plugin entry point
│           ├── plugin.test.ts     # contract tests
│           └── README.md          # dev notes
├── media-service/
│   ├── index.ts                   # MediaService class
│   ├── dispatch.ts                # strategy dispatch logic
│   ├── cache.ts                   # cache key + TTL logic
│   ├── id-resolver.ts             # id_map read/write
│   ├── errors.ts                  # PluginCallError, error normalization
│   └── resolve-connection.ts      # connection resolution including shared creds
├── plugin-runtime/                # from plugin architecture doc
└── capabilities/
    ├── index.ts                   # capability registry
    ├── metadata-v1.ts             # MetadataV1 capability definition
    └── ... other capabilities as they land

sdk/
├── plugin-sdk.d.ts                # generated types
├── plugin-sdk.js                  # one-line definePlugin helper
├── README.md
└── scripts/
    └── generate.ts                # pnpm gen:sdk

docs/
└── plugin-authoring-guide.md      # how to write a plugin
```

## Testing

### MediaService unit tests

- Strategy dispatch: each strategy (`single`, `aggregate`, `primary_with_enrichment`) with mocked runtime returning success, permanent error, transient error, timeout.
- Cache behavior: hit, miss, TTL expiry, invalidation by prefix, negative cache.
- Connection resolution: user-only, shared-only, user-with-shared-fallback-disabled, both present.
- `id_map` harvesting: opportunistic path, explicit gap-fill path, ownership enforcement, first-writer behavior for `imdb_id`.
- Error code mapping: each `PluginErrorCode` produces the right retry/status-update behavior.

### TMDB plugin contract tests

- Boot in a real QuickJS instance with a mock `ctx`.
- `startAuth` with valid/invalid API key (mocked `ctx.fetch`).
- `getById` for a movie, TV show, nonexistent id (404), rate-limited response (429), server error (500).
- `search`, `getSimilar` happy paths.
- `healthCheck` job.
- `testConnection` reserved method.

### Integration tests

- End-to-end: admin installs TMDB (mocked as built-in), user adds personal API key, request `mediaService.getMetadata` fans through the full pipeline.
- Shared-credentials path: admin sets shared key via `plugin.setSharedCredentials`, user with no personal connection gets metadata.
- Cache invalidation: mutating call on another capability (future watch history write) invalidates watch history cache, not metadata cache.

## Open questions / deferred

- **Rate limit coordination across connections.** If a user has a personal TMDB key and shared key exists, we never use both — but for aggregate capabilities across plugins with separate rate limits, per-plugin rate limit accounting is needed. Deferred; LRU token bucket per plugin id is the likely answer.
- **Streaming responses.** Some capabilities (search as the user types) might benefit from streaming. Not in v1; all methods are request/response.
- **Plugin-declared capability extensions.** Can a plugin declare capabilities the host doesn't know about? Currently no — install fails. Worth revisiting if the third-party plugin ecosystem grows.
- **Capability-level permissions.** Later, a user might want to allow plugin A for metadata but not for recommendations. v1: all or nothing at the connection level.

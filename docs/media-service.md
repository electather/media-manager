# MediaService & TMDB Plugin

Status: Draft | Date: 2026-04-19 | Author: Omid Astaraki
Depends: `2026-04-19-plugin-architecture-design.md`, `2026-04-19-frontend-connections-design.md`
Revises: Adds `sharedCredentials` to plugin architecture (§10)

## Summary

Design `MediaService` — sole facade for plugin-backed features — & TMDB builtin. Forces plugin architecture abstractions to concrete code; shakes out dispatch fan-out, cache key composition, error flow across sandbox, shared-credential slot-in.

Scope: `metadata@v1` only, TMDB only. Subsequent plugins (Trakt, Seerr, TVDB) follow same pattern, different auth/caps.

## Goals

✓ `MediaService` = sole surface for plugin features
✓ TMDB = reference impl for `metadata@v1` + shared-credentials pattern
✓ Capability dispatch strategy system (concrete, not hand-wave)
✓ Caching, error handling, `id_map` population formalized
✓ SDK type bundle & error code vocabulary

## Non-goals

✗ Trakt, Seerr, TVDB (follow-up specs, same pattern)
✗ Capabilities beyond `metadata@v1`
✗ MCP tool integration (later)
✗ RPC procedures (already specified in plugin architecture doc)

## Architecture

```
     ┌──────────────────────────────┐
     │ Caller (RPC/MCP/job/...)    │
     └────────────┬─────────────────┘
                  ▼
     ┌──────────────────────────────┐
     │     MediaService             │
     │ • resolveStrategy            │
     │ • resolveConnections         │
     │ • cache get/set              │
     │ • dispatch → runtime         │
     │ • merge/aggregate errors     │
     │ • id_map harvest             │
     └────┬──────────────────┬──────┘
          ▼                  ▼
    ┌──────────────┐   ┌──────────────┐
    │ Capability   │   │ Plugin Runtime│
    │ Registry     │   │ (QuickJS)     │
    └──────────────┘   └──────────────┘
```

MediaService = only component knowing capability strategy & plugin dispatch. Callers never touch registry/runtime.

## `MediaService` Surface

```ts
class MediaService {
  // capability calls — 1 method per capability+method pair
  getMetadata(userId: string, id: MediaId): Promise<MediaItem | null>;
  searchMetadata(userId: string, query: string, opts?: SearchOpts): Promise<MediaItem[]>;
  getSimilar(userId: string, id: MediaId): Promise<MediaItem[]>;
  getArtwork(opts: {
    ids: ArtworkIdMap;
    type: MediaType;
    languages?: string[];
  }): Promise<ArtworkBundle>;
  resolveIds(requests: Array<{ from: string; id: string; type: MediaType }>): Promise<IdBundle[]>;
  // ... future

  // health/ops — jobs & admin
  testConnection(connectionId: string): Promise<TestResult>;
  invalidateUserCache(userId: string, scope?: CacheScope): Promise<void>;
}
```

`getArtwork` = cache-first wrapper around `artwork@v1` aggregate dispatch. Reads capability-layer cache keyed on `(idsHash, type, langPrefHash)`; on miss runs `aggregate_per_kind` strategy, writes cache, returns bundle. Throws `artwork.unsupported_id_combo` when no provider eligible. Returns empty bundle (cached negative) when all eligible providers return empty | throw. See `docs/2026-04-26-plugin-fanart-design.md`.

`resolveIds` = batched wrapper over existing host-internal `idResolver`. Returns array aligned to input; each element = whatever ids resolved (tmdb/imdb/tvdb keys present where known). Empty bundle = no resolution found. Reads existing `id_map` cache. Adopts `idResolve@v1` mixed-scope rules per architecture-doc.

Thin facade. Each method:

1. Look up capability strategy in registry
2. Build cache key: capability + method + args + (user_id if user-scoped)
3. Cache hit → return
4. Cache miss → resolve connections (which plugins, which creds)
5. Dispatch via strategy (single / aggregate / primary_with_enrichment / aggregate_per_kind)
6. Harvest `id_map` from successful responses
7. Store merged result in cache with capability TTL
8. Return

New capability = 1 method here, 1 strategy decl, strategy-specific logic. No new dispatch pipeline.

## Capability Strategies

Capability declares dispatch strategy host-side. `MediaService` reads from registry & dispatches.

```ts
// Tagged-union shape — extensible via discriminated `kind`. Earlier draft used
// flat enum; widened when artwork@v1 introduced the per-kind merge variant.
type Strategy =
  | { kind: "single" } // 1 connection; fail = total fail
  | { kind: "aggregate" } // call all, merge (union semantics)
  | { kind: "primary_with_enrichment"; primary: PluginId; enrich: PluginId[] }
  // user picks primary; others fill nulls
  | { kind: "aggregate_per_kind"; perKindFields: string[] };
// call all, first non-empty wins per declared
// bundle field. Used by artwork@v1.

export const MetadataV1 = defineCapability({
  id: "metadata",
  version: "v1",
  strategy: { kind: "primary_with_enrichment" },
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

| Capability           | Strategy                  | Rationale                                      |
| -------------------- | ------------------------- | ---------------------------------------------- |
| `metadata@v1`        | `primary_with_enrichment` | User picks primary per type; others fill gaps  |
| `watchHistory@v1`    | `aggregate`               | Merge from all trackers                        |
| `watchlist@v1`       | `aggregate`               | Union all                                      |
| `ratings@v1`         | `aggregate`               | Union, newest wins per item                    |
| `recommendations@v1` | `aggregate`               | Merge & dedupe by tmdb_id                      |
| `calendar@v1`        | `aggregate`               | Merge upcoming from all                        |
| `mediaRequest@v1`    | `single`                  | Route to user's default Seerr                  |
| `idResolve@v1`       | Internal                  | Fill `id_map` gaps                             |
| `artwork@v1`         | `aggregate_per_kind`      | Fanart preferred, TMDB fallback per asset kind |

Strategy = capability-level property, not per-method. Methods disagreeing on strategy → really 2 capabilities, split.

### Strategy Dispatch Semantics

**`single`:**

- Resolve 1 connection (user's default for plugin, or sole plugin with capability)
- No connection → empty (read) or throw `NoConnectionError` (write/request)
- Plugin failure = operation failure. No fan-out retry.
- Plugin-level transient retry still applies (per Q3)

**`aggregate`:**

- Resolve all user connections matching capability, all plugins
- Fan-out parallel, per-call timeout default 15s (configurable per capability)
- Results: success | permanent error | transient error (post-retry) | timeout
- Merge = array union + capability-specific dedupe. E.g. watch history: dedupe by `(tmdb_id, watched_at)`, watchlist: dedupe by `tmdb_id`. Capability defines dedupe fn.
- Failed calls update connection `status` (per Q3); don't poison aggregate result
- Response: merged data + `errors: [{connectionId, pluginId, code, message}]`. Caller decides presentation.

**`primary_with_enrichment`:**

- User designates primary connection per dimension (metadata: per media type). Stored in `user_preferences`.
- Primary = base. Enrichment fills null/missing fields.
- Enrichment order = stable by plugin install date
- Primary failure → operation returns enrichment-only data (treated as partial aggregate result)
- All failures update connection `status` (per Q3)

**`aggregate_per_kind`:**

- Resolve all eligible providers (capability extras like `supportedIdTypes` filter ineligible providers up-front; see capability docs).
- Order eligible providers by capability-declared `providerPriority` (lower = higher priority); ties broken alphabetical by plugin id.
- Fan-out parallel, per-call timeout default 15s.
- Merge per-kind: for each field listed in `strategy.perKindFields`, walk results in priority order, take first non-empty array.
- All eligible providers fulfilled w/ empty | all eligible providers throw → return empty bundle (every kind empty array). All-empty cached as negative; all-fail ⊥ cached.
- Zero eligible providers (no provider can serve given input) → throw capability-specific `unsupported` error (e.g. `artwork.unsupported_id_combo`).
- Failed provider calls update connection `status`; ⊥ poison merged result.

### Response Merge Safety

Plugin responses cross trust boundary — payload may originate from external HTTP API via `JSON.parse`. `JSON.parse('{"__proto__":{...}}')` produces obj w/ own `__proto__` key, untouched by Zod `.strip()` ⊥ enforced. Merging via naive recursive copy → prototype pollution: writes attacker keys onto `Object.prototype`, worker-wide.

Strategies that recursively merge plugin responses (`primary_with_enrichment`, future strategies w/ similar shape) MUST defend in 3 layers:

1. **Key filter on merge loop.** Skip `__proto__`, `constructor`, `prototype` at top of recursive merge fn (`fillGaps` in `primary-with-enrichment.ts`). Blocks descent into `Object.prototype` via property accessor.
2. **Owned deep copy via `safeClone`.** `safeClone` produces a fresh plain-object tree, recursively filtering `DANGEROUS_KEYS` at every depth. Merge target never shares allocation with raw plugin output. Plain prototype intentional — null-proto would break callers using `Object.prototype` methods on nested objects (`result.data.ids.hasOwnProperty(...)`).
3. **Zod `.strip()` on every plugin capability response.** Default Zod behaviour; `.passthrough()` BANNED on capability response schemas. plugin-sdk enforces — schema parse runs at plugin-sdk boundary before response reaches dispatch layer. Audit covers every capability handler in `packages/plugins/*` + plugin-sdk response-validation wrapper.

Regression test in `apps/server/src/media/__tests__/primary-with-enrichment.test.ts`: feed `JSON.parse('{"__proto__":{"polluted":true}}')` as enrichment payload, assert `({} as any).polluted === undefined` after merge. Cover `constructor` + `prototype` keys same way. Legit nested merge (e.g. `ids: { tmdb: ..., imdb: ... }`) still works.

Tracked: issue #451.

### Cache TTL Defaults

Capability defines `defaultCacheTtlSec` (and optional `defaultNegativeCacheTtlSec`). Admin overrides per-capability via `/admin/plugins` (future UI):

| Capability           | Positive TTL | Negative TTL | Notes                                                                                                                                                                               |
| -------------------- | ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata@v1`        | 24h          | 5m (default) | Stable titles/overviews                                                                                                                                                             |
| `watchHistory@v1`    | 5m           | 5m (default) | User expects near-real-time                                                                                                                                                         |
| `watchlist@v1`       | 5m           | 5m (default) | Same                                                                                                                                                                                |
| `ratings@v1`         | 15m          | 5m (default) |                                                                                                                                                                                     |
| `recommendations@v1` | 6h           | 5m (default) |                                                                                                                                                                                     |
| `calendar@v1`        | 1h           | 5m (default) | Provider-side schedule updates                                                                                                                                                      |
| `artwork@v1`         | 24h          | 6h           | Negative TTL deliberately longer than system default — niche titles legitimately have no fanart-quality art; refresh hourly = waste. See `docs/2026-04-26-plugin-fanart-design.md`. |

Capabilities can override the system 5m negative TTL via `defaultNegativeCacheTtlSec`. Use sparingly — longer negative TTL trades freshness for upstream-call savings; only justified when the negative result is truly stable (e.g. an item ⊥ in a third-party catalog).

## Caching

### Location

`MediaService` level only. Plugins don't cache — `ctx.store` for plugin-internal state (cursors, tokens, etc.). Defense-in-depth = YAGNI.

### Key Composition

Canonicalized string:

```
mv:{capability}:{version}:{method}:{scope}:{argsHash}
```

- `scope` = `global` (user-independent, e.g. metadata) or `user:{userId}` (user-scoped)
- `argsHash` = `sha256(JSON.stringify(canonicalize(input)))` truncated 16 hex. Canonicalization = sort keys recursively.
- Capability-level scope declared in definition (`userScoped: boolean`)
- **Per-capability `argsHash` decomposition (optional).** A capability may decompose `argsHash` into multiple human-readable segments when separation aids readability of cache keys, prefix-flush patterns, or debugging. E.g. `artwork@v1` uses `<idsHash>:<type>:<langPrefHash>` so logs surface the type + lang preference inline rather than burying them in an opaque hash. Decomposed segments still hash any free-form payload (so `idsHash` covers the `{ tmdb?, imdb?, tvdb? }` map). Capabilities that don't decompose stay on the single-hash default. See `docs/2026-04-26-plugin-fanart-design.md` §"Cache key" for an example.

### Backend

`CacheProvider` interface:

```ts
interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}
```

Implementations:

- `LruCacheProvider` — in-process, default single-instance
- `RedisCacheProvider` — shared, multi-instance

Config via env: `CACHE_BACKEND=lru|redis`, `REDIS_URL=...`

### Invalidation

Three event sources, each with own cache scope:

| Event source                                                     | Scope flushed                                                        | Mechanism                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutating capability call (e.g. `addToHistory`)                   | Affected user's keyspace for that capability                         | `cache.deleteByPrefix("mv:{cap}:{ver}:*:user:{userId}:*")` post-success                                                                                                                                                     |
| Connection change (create / update / delete / enable / disable)  | Affected user's keyspace for capabilities the plugin implements      | Event-driven from connections layer                                                                                                                                                                                         |
| Plugin enable/disable (admin `plugin.enable` / `plugin.disable`) | All keyspaces for capabilities the plugin implements (global + user) | Event-driven from plugin-state-change pipeline; emits `plugin:state-changed` event w/ `pluginId` payload; cache layer iterates capabilities the plugin declares + calls `cache.deleteByPrefix("mv:{cap}:{ver}:*")` for each |

Each mutating method declares its invalidation prefix pattern; non-mutating reads ⊥ trigger invalidation.

**Plugin-level events for global-scope capabilities.** Connection-level invalidation is per-user — wrong trigger for global-scope capabilities (e.g. `metadata@v1`, `watchProviders@v1`, `trailers@v1`, `artwork@v1`) where cache entries serve every user. Plugin enable/disable = the only event that should flush global keyspaces. Pipeline lives in `apps/server/src/plugin-runtime/` and emits the event in same code path that adds/removes the plugin from the dispatch registry.

**Cross-capability flush from one plugin event.** Plugins implementing multiple capabilities (e.g. TMDB implements `metadata@v1`, `idResolve@v1`, `watchProviders@v1`, `trailers@v1`, `artwork@v1`) → single `plugin:state-changed` event flushes all five keyspaces. Cache layer reads capability list from plugin manifest; ⊥ remember registration history.

### Negative Caching

Null results (nonexistent tmdb_id) cached shorter TTL (system default 5m) to prevent hammering external APIs for bad inputs. Errors not cached. Capabilities can override system default via `defaultNegativeCacheTtlSec` in `defineCapability` — see §"Cache TTL Defaults" table.

## Error Handling

Plugins return errors as structured data, not thrown exceptions. Exceptions in QuickJS caught by runtime → error objects.

### Error Code Vocabulary

Reserved codes: `{ status: "error", code, message }`

```ts
type PluginErrorCode =
  | "token_expired" // OAuth token expired; trigger refresh
  | "bad_credentials" // Invalid creds; connection → "error"
  | "rate_limited" // API rate limit hit; retry w/ backoff
  | "transient_network" // Network fail or 5xx; retry once
  | "not_found" // Resource missing; null result, no error in aggregate
  | "bad_input" // Caller-side error; surface as-is
  | "internal"; // Plugin bug or unexpected state
```

Host behavior:

| Code                | Retry?                               | Update Status?               | Propagate?                          |
| ------------------- | ------------------------------------ | ---------------------------- | ----------------------------------- |
| `token_expired`     | Trigger refresh, retry once          | → `expired` if refresh fails | If final failure                    |
| `bad_credentials`   | No                                   | → `error` w/ message         | Yes                                 |
| `rate_limited`      | Yes, Retry-After or 2s backoff, once | No                           | If retry fails                      |
| `transient_network` | Yes, 1s backoff, once                | No                           | If retry fails                      |
| `not_found`         | No                                   | No                           | Null (`single`), skip (`aggregate`) |
| `bad_input`         | No                                   | No                           | Yes                                 |
| `internal`          | No                                   | → `error` w/ message         | Yes                                 |

The background per-connection job path (`invokePerConnectionHandler` in `apps/server/src/jobs/plugin-jobs.ts`) follows the same status-routing rule: `plugin.token_expired` → `expired` + `auth-expired` event (emitted only on first transition into `expired`, since the job iterates every connection each tick), anything else → `error`.

### Timeouts

Per-call default 15s, overridable per capability. Treated as `transient_network` for retry/status.

### Partial Failure (Aggregate)

Response shape when plugin fails in `aggregate` or `primary_with_enrichment`:

```ts
interface AggregateResult<T> {
  data: T;
  errors: [{ connectionId; pluginId; code; message }];
}
```

Caller passes both to frontend. UI decides presentation: show data + subtle "Some sources unavailable" indicator linked to connection status.

`single` strategy: failures → thrown errors, same shape, `PluginCallError` class.

## `id_map` Population

Two paths:

### Opportunistic (Path A)

Capability methods returning media items include optional `ids` field:

```ts
const MediaItemSchema = z.object({
  tmdb_id: z.string(),
  media_type: MediaTypeEnum,
  title: z.string(),
  // ... fields
  ids: z
    .object({
      imdb_id: z.string().nullable().optional(),
      tvdb_id: z.string().nullable().optional(),
      trakt_id: z.string().nullable().optional(),
      trakt_slug: z.string().nullable().optional(),
    })
    .optional(),
});
```

Post-success, `MediaService` walks items, extracts `ids`, upserts to `id_map` via `idResolver`. Plugin authors get population as side-effect of response shape.

### Explicit Gap-Fill (Path B)

When `MediaService` has `tmdb_id` but needs other ID (e.g. Trakt needs `trakt_slug`):

1. Check `id_map` for existing mapping
2. On miss, find plugins declaring `idResolve@v1`, call first match
3. Cache result via opportunistic write

`idResolve@v1` = internal-use only, not direct feature call. Separate capability for opt-in.

### Conflict Resolution (First-Writer for imdb_id)

Ownership mapping:

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

- Field owner = specific plugin → only that plugin overwrites. Others ignored.
- Field owner = `first_writer` → first non-null wins, contradictions logged (debug), ignored.
- Owner plugin not installed → any plugin populates field (first-writer fallback, avoid empty maps).

`idResolver` = host-internal, exposed only to `MediaService`. Plugins never access.

## Connection Resolution

`MediaService.resolveConnections(userId, pluginId): ResolvedConnection[]`

```ts
type ResolvedConnection =
  | { kind: "user"; connection: ServiceConnection; credentials: TCred; userConfig: TUserCfg }
  | { kind: "shared"; plugin: Plugin; credentials: TCred };
```

Resolution:

1. User has personal connections for plugin → return all as `kind: "user"` (multiple instances = multiple entries)
2. Else plugin declares `allowsSharedCredentials: true` AND admin set shared creds → single `kind: "shared"` entry
3. Else empty

`single` strategy: picks default from `kind: "user"` or `kind: "shared"`, or throws.
`aggregate`: dispatch all in parallel.

Plugin methods agnostic to personal vs shared. `ctx.credentials` uniformly populated by host.

## Runtime Dispatch (Detailed)

Per plugin call:

1. Input validation vs capability input schema (Zod). Fail: `bad_input`
2. Build `PluginContext`:
   - `fetch` wrapper w/ `manifest.allowedHosts` check + rate-limit enforcement
   - `log` tagged plugin id + optional user id
   - `credentials` from resolved connection
   - `config.global` from `plugins.global_config`
   - `config.user` from `service_connections` row (empty for `kind: "shared"`)
   - `store` namespaced to `(plugin_id, user_id)`
3. Invoke capability method in long-lived QuickJS w/ 15s interrupt timer (or capability-specific override)
4. Catch exceptions, normalize → `{ status: "error", code: "internal", message }`
5. Apply retry rules (per Q3) for `rate_limited` / `transient_network`
6. Validate output vs capability output schema. Mismatch → `internal` error.
7. Return normalized result to `MediaService`

## TMDB Plugin

Reference impl, builtin. Location: `server/plugins/builtin/tmdb/` (will move to `packages/plugins/tmdb/` per `docs/2026-04-25-plugin-monorepo-design.md`).

> **Pre-migration snapshot.** The manifest block below = original 2026-04-19 shape using `allowsSharedCredentials` + `auth: "form"` + per-user `api_key`. Current authoritative TMDB manifest moved to pure-global pattern: `auth: { kind: "none" }`, `poolable: true`, `sharedCredentialsSchema: { apiKey }`, `capabilities` includes `metadata@v1`, `idResolve@v1`, `watchProviders@v1`, `trailers@v1`, `artwork@v1`. See `docs/2026-04-19-plugin-architecture-design.md` §"Concrete Plugin Mappings" + `docs/2026-04-26-plugin-fanart-design.md` §"`@ent-mcp/plugin-tmdb` delta" for current fields. Block kept for historical context — illustrates dispatch + caching patterns; manifest detail does ⊥ reflect repo state.

### Manifest

```ts
{
  id: "tmdb",
  name: "The Movie Database",
  version: "1.0.0",
  description: "Movie and TV metadata from TMDB",
  logoUrl: "https://www.themoviedb.org/assets/2/v4/logos/...",
  author: { name: "your-app", url: "https://..." },
  homepage: "https://www.themoviedb.org/",

  sdkVersion: "^1.0.0",
  allowedHosts: ["api.themoviedb.org", "image.tmdb.org"],

  // admin-only settings, not cred fallback
  globalConfigSchema: {
    type: "object",
    properties: {
      imageBaseUrl: {
        type: "string",
        format: "uri",
        title: "Image base URL",
        description: "Override default TMDB image CDN",
        default: "https://image.tmdb.org/t/p/",
      },
    },
    required: [],
  },

  // per-user config — user-set API key
  userConfigSchema: {
    type: "object",
    properties: {
      api_key: {
        type: "string",
        title: "API Key",
        description: "Personal TMDB API key (v3 auth)",
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

  allowsSharedCredentials: true,  // admin sets shared API key

  auth: { kind: "form" },
  capabilities: { metadata: "v1" },
  jobs: [
    { id: "healthCheck", schedule: "0 */6 * * *", handler: "healthCheck", perConnection: true },
  ],
}
```

### `userConfigSchema` vs `credentialsSchema`

Form-auth plugins: schemas often identical. User types API key → becomes credential. `startAuth`:

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

Form field once; same value in both encrypted blobs. Fine — different lifecycles even if match at creation (user can rotate via edit, updates both).

### Auth Flow

Per plugin architecture §6:

- `authKind: "form"` → user fills API key, host calls `startAuth`, plugin tests `/authentication`, returns `{ status: "completed", credentials }`
- `testConnection(ctx)` hits same endpoint w/ stored creds
- No `refreshAuth` needed (API keys don't expire)

### `metadata@v1` Implementation

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

`mapMovieOrTv` = plugin-internal helper, maps TMDB response to `MediaItemSchema`, extracts `ids.imdb_id` from `external_ids` for opportunistic `id_map` population.

### Health Check Job

Per connection, every 6h:

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

## Schema Revision: `shared_credentials`

Add to `plugins` table:

```
plugins
  ...
├── shared_credentials          text    (encrypted, nullable)
├── shared_credentials_iv       text    (nullable)
```

New manifest field: `allowsSharedCredentials: boolean`. When true:

- Admin UI shows "Shared credentials" section, rendered from `credentialsSchema`
- `plugin.setSharedCredentials` endpoint writes encrypted blob + iv
- `plugin.listAvailable` returns `hasSharedConfig: boolean` (supersedes "global_config populated" check)

`globalConfig` = pure meaning: admin-only settings in `ctx.config.global`, never cred fallback.

## SDK Delivery

### v1: Raw `.d.ts` in repo

- File: `sdk/plugin-sdk.d.ts` at repo root
- Generated from Zod schemas via `pnpm gen:sdk`
- Committed to git. CI enforces no drift: `pnpm gen:sdk` in CI must produce no diff.
- Plugin authors copy next to source, reference via `/// <reference path="./sdk.d.ts" />` or `import type`. Docs in `sdk/README.md`.
- Updates: authors re-download on new SDK version.

### Future: GitHub Releases

Once SDK shape stabilizes (~3 plugin releases, no breaking changes), cut v1.0 release w/ `.d.ts` as asset. Authors pin to tag, update deliberately.

### SDK Contents

Types only. No runtime code. Keeps plugin bundle minimal — nothing from SDK bloats QuickJS-loaded JS.

```ts
// sdk/plugin-sdk.d.ts (generated)

export interface PluginManifest { /* ... */ }
export interface PluginContext<TCred, TUserCfg, TGlobalCfg> { /* ... */ }

// reserved error codes
export type PluginErrorCode =
  | "token_expired" | "bad_credentials" | "rate_limited"
  | "transient_network" | "not_found" | "bad_input" | "internal";

// capability interfaces (generated from host Zod schemas)
export interface MetadataV1Methods {
  getById(ctx: PluginContext<...>, input: MetadataGetByIdInput): Promise<MetadataGetByIdOutput>;
  search(ctx: PluginContext<...>, input: MetadataSearchInput): Promise<MetadataSearchOutput>;
  getSimilar(ctx: PluginContext<...>, input: MetadataGetSimilarInput): Promise<MetadataGetSimilarOutput>;
}
// ... other capabilities

// domain types
export interface MediaItem { /* ... */ }
export type MediaType = "movie" | "tv";

// status payload unions
export type StartAuthResult<TCred> =
  | { status: "completed"; credentials: TCred }
  | { status: "redirect"; url: string; state: string }
  | { status: "display_code"; code: string; verifyUrl: string; pollState: string; intervalSec: number }
  | { status: "error"; code: PluginErrorCode; message: string };
// ... pollAuth, completeAuth, etc.

// plugin shape & definePlugin inferred type
export interface Plugin<TManifest extends PluginManifest> { /* ... */ }
export function definePlugin<TCred, TUserCfg, TGlobalCfg>(
  plugin: PluginDefinition<TCred, TUserCfg, TGlobalCfg>,
): PluginDefinition<TCred, TUserCfg, TGlobalCfg>;
```

`definePlugin` = only runtime symbol. Identity at runtime, pure types compile-time. `.d.ts` declares signature; plugin provides trivial impl:

```js
// sdk/plugin-sdk.js — optional for authors wanting runtime
export const definePlugin = (p) => p;
```

Authors: import file OR paste one-liner. Both work.

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
│   └── resolve-connection.ts      # connection resolution + shared creds
├── plugin-runtime/                # from plugin architecture doc
└── capabilities/
    ├── index.ts                   # capability registry
    ├── metadata-v1.ts             # MetadataV1 definition
    └── ... other capabilities

sdk/
├── plugin-sdk.d.ts                # generated types
├── plugin-sdk.js                  # one-line definePlugin
├── README.md
└── scripts/
    └── generate.ts                # pnpm gen:sdk

docs/
└── plugin-authoring-guide.md      # write a plugin
```

## Testing

### MediaService Unit Tests

- Strategy dispatch: `single`, `aggregate`, `primary_with_enrichment`, `aggregate_per_kind` w/ mocked runtime (success, permanent error, transient error, timeout)
- Cache behavior: hit, miss, TTL expiry, invalidation by prefix, negative cache
- Connection resolution: user-only, shared-only, user-with-shared-fallback-disabled, both
- `id_map` harvesting: opportunistic path, ownership enforcement, first-writer for `imdb_id`
- Error code mapping: each `PluginErrorCode` → right retry/status-update behavior

### TMDB Plugin Contract Tests

- Boot in real QuickJS w/ mock `ctx`
- `startAuth` valid/invalid API key (mocked `ctx.fetch`)
- `getById` movie, TV, nonexistent (404), rate-limited (429), 500
- `search`, `getSimilar` happy paths
- `healthCheck` job
- `testConnection` reserved method

### Integration Tests

- End-to-end: admin installs TMDB (builtin), user adds personal API key, `mediaService.getMetadata` flows full pipeline
- Shared-credentials: admin sets key via `plugin.setSharedCredentials`, user w/o personal connection gets metadata
- Cache invalidation: mutating call on future capability (watch history write) invalidates watch history cache, not metadata

## Open Questions / Deferred

**Rate limit coordination across connections:** User has personal TMDB key + shared key exists → never use both. But aggregate capabilities across plugins w/ separate rate limits need per-plugin accounting. Deferred; likely LRU token bucket per plugin_id.

**Streaming responses:** Search as user types could stream. Not v1; all methods request/response.

**Plugin-declared capability extensions:** Plugin declares unknown capability → host rejects install. Worth revisit if third-party ecosystem grows.

**Capability-level permissions:** User allows plugin A for metadata, not recommendations. v1: all-or-nothing at connection level.

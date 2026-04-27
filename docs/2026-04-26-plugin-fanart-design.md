# Fanart Plugin & `artwork@v1` Capability

**Status:** Draft for review
**Date:** 2026-04-26
**Author:** Omid Astaraki
**Deps:** `2026-04-19-plugin-architecture-design.md`, `2026-04-25-plugin-monorepo-design.md`, `2026-04-22-home-feed-design.md`, `2026-04-19-error-management-design.md`, `media-service.md`

## Summary

New built-in plugin `@ent-mcp/plugin-fanart` + new aggregate-shaped capability `artwork@v1`. Pure-global, poolable, single API key per pool entry. Provides HD posters, backdrops, clear logos, thumbs from fanart.tv keyed by tmdb/imdb (movies) | tvdb (tv).

TMDB plugin gains second implementation of `artwork@v1` so dispatcher can fall back to TMDB images when fanart not configured | item absent from fanart's catalog. New aggregate strategy `aggregate_per_kind` merges responses per asset kind w/ provider priority — fanart preferred, TMDB fallback per-kind.

New top-level RPC `artwork.get` = sole image source for client. `CompactMediaItem` (home-feed) drops `poster`/`backdrop`/`clearLogo` fields; client renders rows w/ skeleton, batches viewport items into `artwork.get`, swaps on response. No server-side eager image plumbing in home-feed pipeline.

## Goals

- New global aggregate capability `artwork@v1` w/ provider-priority + per-kind first-non-empty merge.
- New built-in plugin `@ent-mcp/plugin-fanart` implementing `artwork@v1`. Pure-global, poolable, `auth: "none"`.
- TMDB plugin gains `artwork@v1` impl for fallback. Additive, backward-compatible minor bump.
- New RPC `artwork.get` = single artwork delivery surface. Authenticated-session only. Batched, max 50 items per call.
- Drop `poster`/`backdrop`/`clearLogo` from `CompactMediaItem`. Client owns lazy-load of artwork via `artwork.get`.
- Cache: capability-layer 24h positive, 6h negative, keyed by `(idsHash, type, langPrefHash)`.

## Non-goals

- Frontend rendering, viewport-batching, blur-up/skeleton UX → home-feed-frontend follow-up doc revision.
- Image proxy / CDN-fronting. Direct CDN URLs only v1 (`assets.fanart.tv`, `image.tmdb.org`).
- Per-render-context size negotiation. Single admin-config-driven size per kind v1.
- Locale-aware `languages` from user profile. `["en", "00"]` server default v1; locale infra ⊥ exists yet in repo.
- Background warm queue. Demand-driven population only.
- MCP `ent_artwork` tool. Agents already get image URLs via `metadata@v1.getDetails`.
- Music artwork. Movies + TV only.

## Architecture

```
Client
  │
  │  RPC: artwork.get({ items: [{ key, ids, type }], languages? })
  ▼
ArtworkRoute  apps/server/src/api/routes/artwork.ts
  │
  ▼
ArtworkService  apps/server/src/artwork/index.ts
  • dedup items by canonicalKey(ids, type)
  • preflight: batch tmdb→tvdb resolution for tv items via idResolve@v1
  • dispatch artwork@v1 per canonical entry (cache-first)
  • per-item error capture, batch-level always 200
  │
  ▼
artwork@v1 capability dispatch  (strategy: aggregate_per_kind)
  │ ┌──────────────────────┐
  ├─►│ @ent-mcp/plugin-tmdb │── /movie|tv/{id}/images
  │ └──────────────────────┘
  │ ┌────────────────────────┐
  └─►│ @ent-mcp/plugin-fanart │── /v3/movies|tv/{id}
    └────────────────────────┘
```

### Boundaries

- Plugin = `@ent-mcp/plugin-fanart` workspace package (per `2026-04-25-plugin-monorepo-design.md`). Implements only `artwork@v1`.
- TMDB plugin gains `artwork@v1` alongside existing `metadata@v1` / `idResolve@v1` / `watchProviders@v1` / `trailers@v1`. Minor version bump.
- `ArtworkService` = thin orchestrator. Stateless, instance per request. Same shape pattern as `HomeFeedService`.
- Cache + aggregate dispatch live in MediaService layer (existing infra) + new strategy variant.

### Out of plugin scope

- Image proxy/resize.
- Per-user art preference (locale).
- TMDB→TVDB resolution (`ArtworkService` owns, plugins ⊥).

## Plugin Manifests

### `@ent-mcp/plugin-fanart`

```
id:                       "fanart"
name:                     "Fanart.tv"
version:                  "0.1.0"
description:              "High-resolution posters, backdrops, clear logos, and thumbs from fanart.tv."
logoUrl:                  "https://fanart.tv/favicon.ico"
author:                   { name: "ent-mcp", url: "https://github.com/electather/media-manager" }
homepage:                 "https://fanart.tv"
sdkVersion:               "^0.1.0"
allowedHosts:             ["webservice.fanart.tv", "assets.fanart.tv"]
auth:                     { kind: "none" }
poolable:                 true

globalConfigSchema:
  assetCdnPrefix?:        string
                          default "https://assets.fanart.tv"
                          admin override when proxying fanart's CDN.
                          Note: this override only rewrites URLs in the
                          server response payload; the URLs are then loaded
                          browser-side by `<img>` tags, not via `ctx.fetch`,
                          so `allowedHosts` does NOT need to include the
                          override origin. Admin running a fanart CDN proxy
                          is responsible for that proxy's reachability.

sharedCredentialsSchema:
  apiKey:                 string  ! required  x-secret: true
                          personal API key; project key (paid) optional —
                          register additional pool entry for higher rate
                          quota. Note: pool rotation policy v1 = round-robin
                          on rate-limit signal; project keys do NOT auto-
                          preference. "Prefer project key when configured"
                          = open question (see §"Open Questions" — fanart
                          project-key vs personal-key freshness).

capabilities:
  artwork:
    version:              "v1"
    scope:                "global"
    supportedIdTypes:     { movie: ["tmdb", "imdb"], tv: ["tvdb"] }
    providerPriority:     10           # lower = higher priority
```

### `@ent-mcp/plugin-tmdb` delta

Existing manifest adds `artwork@v1` to `capabilities`:

```
artwork:
  version:                "v1"
  scope:                  "global"
  supportedIdTypes:       { movie: ["tmdb"], tv: ["tmdb"] }
  providerPriority:       20
```

**Asymmetric id support.** TMDB's `supportedIdTypes` is `tmdb`-only — fanart accepts imdb for movies, TMDB does not. Movie items carrying only `imdb` ⊥ have a fallback when fanart 404s. Edge case covered in §"Open Questions / Deferred" → "IMDB-only movie items".

Existing `globalConfigSchema.imageBaseUrl` (already on TMDB plugin manifest, default `"https://image.tmdb.org/t/p"`) reused — ⊥ new field. `artworkSizes` block adds:

```
artworkSizes:
  poster:                 string  default "w780"
  backdrop:               string  default "w1280"
  logo:                   string  default "w500"
                          TMDB serves arbitrary sizes via path segment;
                          plugin emits one URL per variant using configured default.
                          Future per-render-context sizes deferred.
```

### Built-in coverage table delta

Adds row to architecture-doc §"Built-in Plugin Coverage":

```
| Capability   | TMDB     | Fanart    | Trakt | Seerr | TVDB | Plex | Jellyfin |
| ------------ | -------- | --------- | ----- | ----- | ---- | ---- | -------- |
| `artwork@v1` | ✓ global | ✓ global  |       |       |      |      |          |
```

## Capability: `artwork@v1`

Lives in `packages/plugin-sdk/src/capabilities/artwork.ts`.

### Method: `getArtwork`

```
input:
  ids:                    { tmdb?: string, imdb?: string, tvdb?: string }
                          ! ≥1 id present
                          tmdb/tvdb match /^\d+$/; imdb match /^tt\d+$/
  type:                   "movie" | "tv"
  languages?:             string[]  default ["en", "00"]
                          preference order; max 8 entries; each 2-8 chars

output: ArtworkBundle
```

### Types

```
ArtworkVariant:
  url:                    string  ! valid URL
  language:               string  ! 2-8 chars; "00" = textless
  likes?:                 number  ! integer ≥ 0
  width?:                 number  ! positive int
  height?:                number  ! positive int

ArtworkBundle:
  poster:                 ArtworkVariant[]   ≤ 5 entries
  backdrop:               ArtworkVariant[]   ≤ 5 entries
  clearLogo:              ArtworkVariant[]   ≤ 5 entries
  thumb:                  ArtworkVariant[]   ≤ 5 entries
                          ∀ kinds always present;
                          empty array = "asked, none found"
                          (distinct from "didn't ask")
```

### Capability-spec extras

Validated by `artwork@v1`'s per-cap manifest schema (same pattern as `notificationDelivery@v1.supportsKinds`). Schema lives in SDK (`packages/plugin-sdk/src/capabilities/artwork.ts`) — single source of truth, used by both server install-time validation and plugin-author dev-time type checking. Server dispatcher reads validated values from the in-memory plugin registry; ⊥ re-validate on each call.

```
supportedIdTypes:         { movie: IdType[], tv: IdType[] }
                          IdType ∈ ["tmdb", "imdb", "tvdb"]
                          ! min 1 per media type
                          dispatcher reads to skip provider when caller's
                          ids map can't satisfy

providerPriority:         number  ! integer ∈ [0, 1000]
                          lower = higher priority;
                          ties broken alphabetical by plugin id (deterministic)
```

### Strategy

`media-service.md` today defines `Strategy` as flat enum: `"single" | "aggregate" | "primary_with_enrichment"`. This spec extends `Strategy` to a tagged-union shape. New variant added; existing variants stay backward-compatible (callers reading `strategy === "aggregate"` migrate to `strategy.kind === "aggregate"` in same commit that introduces tagged shape — see Migration §step 1).

```
Strategy =
  | { kind: "single" }
  | { kind: "aggregate" }                          # existing — generic merge, list concat
  | { kind: "primary_with_enrichment", primary: PluginId, enrich: PluginId[] }
  | { kind: "aggregate_per_kind",                  # NEW — this spec
      perKindFields: string[] }                    # ! ≥1; ordered list of bundle field names

artwork@v1.strategy:
  kind:                   "aggregate_per_kind"
  perKindFields:          ["poster", "backdrop", "clearLogo", "thumb"]
```

Distinct `kind` chosen over reusing `"aggregate"` w/ optional `merge` discriminant — keeps each strategy variant orthogonal at type level, prevents existing `aggregate` consumers from accidentally engaging per-kind merge logic.

## Aggregate Strategy: `aggregate_per_kind`

New variant in `apps/server/src/plugin-runtime/strategies/`. Sibling to existing `single` / `aggregate` / `primary_with_enrichment`. Adopts tagged-union `Strategy` shape (see §"Capability: `artwork@v1`" → §Strategy).

### Pseudocode

```
dispatch(call, providers):
  eligible = providers.filter(canServe(_, call.input.ids, call.input.type))
  if eligible.empty:
    throw hostError("artwork.unsupported_id_combo")

  # Sort = merge-priority ordering only. Dispatch itself is parallel —
  # all eligible providers fire concurrently regardless of priority.
  # Priority decides who wins per-kind during merge, not who runs first.
  eligible.sortBy(p → p.manifestSpec.providerPriority asc)

  # Promise.allSettled — one provider throwing must NOT propagate; merge
  # walks fulfilled results in priority order, skips rejections.
  results = await Promise.allSettled(eligible.map(p → p.invoke(call.input)))
  bundle  = { poster: [], backdrop: [], clearLogo: [], thumb: [] }

  ∀ kind ∈ ["poster", "backdrop", "clearLogo", "thumb"]:
    ∀ result ∈ results (priority order):
      if result.fulfilled & result.value[kind].length > 0:
        bundle[kind] = result.value[kind]
        break
  return bundle
```

### `canServe` predicate

```
canServe(provider, ids: ArtworkIdMap, type):
  return provider.supportedIdTypes[type].any(t → ids[t] present)
```

Provider eligible if at least one of its `supportedIdTypes[type]` has a corresponding id in caller's `ids` map. Examples:

- Fanart, `type: "tv"`, ids `{ tmdb: "1396" }` → supported `["tvdb"]` → `ids.tvdb` absent → ineligible.
- Fanart, `type: "tv"`, ids `{ tmdb: "1396", tvdb: "12345" }` → eligible.
- TMDB, `type: "tv"`, ids `{ tmdb: "1396" }` → eligible.
- TMDB, `type: "movie"`, ids `{ imdb: "tt0137523" }` → ineligible (TMDB needs `tmdb`).

### Aggregate-empty vs ineligible

| Case                                        | Dispatcher behavior                                            | Service-level surface                             |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| ≥1 eligible, all fulfilled w/ empty bundles | Return empty bundle. Cache as negative (6h).                   | `results[key] = emptyBundle`. ⊥ error.            |
| ≥1 eligible, some throw, some return data   | Merge per-kind from successful. Errors logged.                 | `results[key] = mergedBundle`. ⊥ error.           |
| ≥1 eligible, all throw                      | Return empty bundle. Errors logged. ⊥ cache (retry next call). | `results[key] = emptyBundle`. ⊥ error.            |
| Zero eligible (canServe filter rejects all) | Throw `artwork.unsupported_id_combo`. ⊥ cached.                | `errors[key] = { code: "unsupported_id_combo" }`. |
| Dispatcher itself crashes (bug)             | Throws non-typed error.                                        | `errors[key] = { code: "internal" }`.             |

**Single decision principle:** dispatcher distinguishes "no provider can answer this question" (throws `unsupported_id_combo` — caller bug, surface to client) from "providers tried and got nothing" (returns empty bundle, cacheable). All-providers-fail = transient → empty bundle, ⊥ cache, retry on next call. ServiceLevel only catches `unsupported_id_combo` + bug-class errors; everything else flows as data.

## RPC Surface: `artwork.get`

`apps/server/src/api/routes/artwork.ts`. Authenticated-user-only (matches `home.getLayout` scope; prevents anon scraping of admin's keys).

### Input

```
items:
  Array<{
    key:                  string  ! 1-128 chars
                          stable client-supplied key; opaque to server;
                          echoed back in results so client joins responses
                          to its own item list
    ids: { tmdb?, imdb?, tvdb? }   # ≥1 id required
    type:                 "movie" | "tv"
  }>
  ! min 1, max 50         # bounded — viewport-burst-sized

languages?:               string[]  ≤ 8
```

### Output

```
results:                  Record<key, ArtworkBundle>
errors?:                  Record<key, ArtworkError>      # per-item, partial
generatedAt:              number                          # ms epoch

ArtworkError:
  code:                   "unsupported_id_combo" | "internal"
  message:                string
```

Per-item errors ⊥ break batch. Top-level RPC stays 200 except for input-shape rejection. Client renders fallback (skeleton | TMDB-stale-default | gradient placeholder) for errored items.

### Auth & rate

- Authenticated session required (401 on missing). Pattern matches `home.getLayout`.
- ⊥ admin variant.
- ⊥ MCP variant.
- Inherits general RPC layer rate-limit; ⊥ new bucket.

## `ArtworkService`

`apps/server/src/artwork/index.ts`. Single class. Stateless — instance per request. ⊥ `RequestScopedLoader` (single procedure, ⊥ fan-in).

### Pseudocode

```
class ArtworkService:
  constructor(mediaService, logger): …

  getArtwork(items, languages = ["en", "00"]):
    # No userId param — artwork@v1 is global-scope, cache keys ⊥ user-scoped.
    # Auth verification + per-user logging context handled at the RPC route
    # layer (apps/server/src/api/routes/artwork.ts) before reaching service.
    # Future locale-aware default would resolve user pref at the route layer
    # and pass through `languages` arg, keeping ArtworkService user-agnostic.
    # 1. Dedup by canonical (idsHash + type). Multiple client keys may
    #    reference same logical item across rows.
    canonical = Map<canonicalKey, { ids, type, clientKeys: [] }>
    ∀ item ∈ items:
      ck = canonicalKey(item.ids, item.type)
      canonical[ck].clientKeys.push(item.key)

    # 2. Preflight tmdb→tvdb for tv items missing tvdb id.
    preflightTvdbResolution(canonical)

    # 3. Dispatch artwork@v1 per canonical entry. mediaService.getArtwork is
    #    new typed method on MediaService (see §"MediaService additions").
    #    Reads aggregate cache → on miss, dispatches artwork@v1 → writes cache.
    #    allSettled semantics: one entry throwing must NOT propagate; every
    #    canonical entry resolves into either results[ck] or errors[ck].
    results = {}, errors = {}
    settled = await Promise.allSettled(
      canonical.values().map(entry → mediaService.getArtwork({
        ids: entry.ids, type: entry.type, languages,
      }))
    )
    ∀ (entry, outcome) ∈ zip(canonical.values(), settled):
      if outcome.fulfilled:
        ∀ ck ∈ entry.clientKeys: results[ck] = outcome.value
      else:
        err = outcome.reason
        if isHostError(err, "artwork.unsupported_id_combo"):
          ∀ ck: errors[ck] = { code: "unsupported_id_combo", message: err.message }
        else:
          # Bug-class fault — dispatcher itself crashed, ⊥ "all providers
          # failed" (which dispatcher absorbs to empty bundle per §dispatcher).
          logger.error({ err, entry }, "artwork dispatch crashed")
          ∀ ck: errors[ck] = { code: "internal", message: "artwork lookup failed" }
    return { results, errors }

  preflightTvdbResolution(canonical):
    needs = canonical.values().filter(e → e.type == "tv" & ⊥ e.ids.tvdb & e.ids.tmdb)
    if needs.empty: return
    # mediaService.resolveIds = new typed batch method (see §"MediaService additions").
    # Wraps existing host-internal idResolver in batch shape.
    resolved = mediaService.resolveIds(
      needs.map(e → { from: "tmdb", id: e.ids.tmdb, type: "tv" }))
    # Mutate canonical entries in place — `needs` holds references into
    # canonical.values(); subsequent dispatch sees populated tvdb id.
    ∀ i: if resolved[i].tvdb: needs[i].ids.tvdb = resolved[i].tvdb
    # Failed resolution: entry passes through. Aggregate dispatch skips fanart
    # for that item (canServe predicate). TMDB still serves (tmdb id present).
    # If TMDB also ineligible → unsupported_id_combo at dispatch time.
```

### Why ⊥ `RequestScopedLoader`

`ArtworkService` does in-method dedup (step 1). ⊥ coalescing across separate RPC calls within session — capability cache handles cross-request repeats. Loader brings nothing here over simple `Map`. Home-feed has loader because multiple row fetchers + signal computation share loader within one `getLayout`; `artwork.get` is single procedure, ⊥ fan-in from disjoint code paths.

### `MediaService` additions

Two new typed methods on `MediaService` (matches existing surface pattern — `getMetadata`, `searchMetadata`, `getInProgress`, etc. — ⊥ generic `invoke`):

```
mediaService.getArtwork({ ids, type, languages }):
  # Cache-first wrapper around artwork@v1 dispatch. Reads capability-layer
  # cache keyed on (idsHash, type, langPrefHash); on miss runs aggregate_per_kind
  # dispatch, writes cache, returns bundle. Throws artwork.unsupported_id_combo
  # when ⊥ provider eligible. Returns empty bundle (cached negative) when all
  # eligible providers return empty | throw.

mediaService.resolveIds(requests: Array<{ from, id, type }>): Array<IdBundle>
  # Batched wrapper around existing host-internal idResolver. Returns array
  # aligned to input; each element = whatever ids resolved (tmdb/imdb/tvdb keys
  # present where known). Empty bundle = no resolution found. Reads existing
  # id_map cache. Adopts idResolve@v1 mixed-scope rules per architecture-doc.
```

Both methods land in `apps/server/src/media-service/` alongside existing methods. `getArtwork` = thin cache-and-dispatch wrapper (~30 LOC). `resolveIds` = batch shape over single-item idResolver already in repo (~20 LOC).

## Caching

### Cache layers

| Layer                            | Scope                                       | TTL                       | Purpose                                |
| -------------------------------- | ------------------------------------------- | ------------------------- | -------------------------------------- |
| Capability cache (MediaService)  | Global, per `(idsHash, type, langPrefHash)` | 24h positive, 6h negative | Repeats across requests                |
| In-method dedup (ArtworkService) | Single `artwork.get` call                   | request lifetime          | Same canonical w/ multiple client keys |

### Cache key

Adopts canonical `MediaService` cache key shape from `media-service.md` §"Key Composition": `mv:{capability}:{version}:{method}:{scope}:{argsHash}`. `argsHash` extends to include the type discriminator + language preference hash:

```
mv:artwork:v1:getArtwork:global:<idsHash>:<type>:<langPrefHash>

idsHash:       canonical hash of sorted-key id map
               { tmdb: "550" }                  → hash A
               { imdb: "tt0137523" }            → hash B
               { tmdb: "550", imdb: "tt..." }   → hash C
               # distinct entries; ⊥ collide

langPrefHash:  stable hash of languages array. Order-sensitive — "en"-first
               vs "fr"-first hash distinct. Length-sensitive — `["en", "00"]`
               vs `["en"]` distinct (latter ⊥ accepts textless).
               ["en", "00"]                     → hash X
               ["en"]                           → hash X'  # distinct from X
               ["fr", "en", "00"]               → hash Y
               ["fr", "en"]                     → hash Y'  # distinct from Y
```

### Negative cache

Empty bundle = `{ poster: [], backdrop: [], clearLogo: [], thumb: [] }`. Cached 6h. Same key, same way. Dispatcher returns same bundle on subsequent identical requests w/o re-hitting providers.

### Provider failure ≠ negative cache

Failed dispatch (all eligible providers throw) ⊥ cached. Next call retries. Prevents transient outage from poisoning cache for 6h.

### Plugin-state-change invalidation

`artwork@v1` = global-scope, so connection-level invalidation = wrong trigger (cache entries serve every user). Admin `plugin.enable` | `plugin.disable` for fanart | tmdb fires `plugin:state-changed` event from `apps/server/src/plugin-runtime/` per `media-service.md` §Invalidation; cache layer iterates capabilities declared by the plugin manifest and calls `cache.deleteByPrefix("mv:artwork:v1:*")`. Single event, both providers' contributions flushed; next request re-dispatches against the surviving provider set. TMDB plugin disabled → fanart-only path; fanart plugin disabled → TMDB-only path. ⊥ new mechanism — reuses existing plugin-state-change pipeline documented in `media-service.md`.

## Plugin Implementations

### `@ent-mcp/plugin-fanart` (pseudocode)

```
plugin.capabilities.artwork.getArtwork(ctx, { ids, type, languages }):
  # Pick id this provider can use.
  id = type == "movie" ? (ids.tmdb ?? ids.imdb) : ids.tvdb
  if ⊥ id:
    # Defensive — dispatcher's canServe filter + this guard together form
    # the safety contract. canServe (§Aggregate Strategy) drops ineligible
    # providers before invoke; this throw catches dispatcher bugs that
    # bypass canServe. Either alone is insufficient: canServe alone trusts
    # the dispatcher; guard alone makes every plugin re-implement
    # eligibility logic.
    throw pluginError("plugin.input_invalid",
      { message: "fanart cannot serve <type> w/o tvdb|tmdb|imdb id",
        retryable: false })

  path = type == "movie" ? "/v3/movies/<id>" : "/v3/tv/<id>"
  res  = ctx.fetch("https://webservice.fanart.tv" + path,
                   { headers: { "api-key": ctx.sharedCredentials.apiKey } })

  # 404 = item ⊥ in fanart's database. ⊥ retryable, ⊥ error.
  # Return empty bundle → dispatcher merges TMDB result → cache as negative.
  if res.status == 404: return emptyBundle()

  # 429/503 = rate-limited | fanart down. Signal pool rotation.
  if res.status ∈ [429, 503]:
    ctx.pool.markExhausted({ retryAfterSec: parseRetryAfter(res.headers) ?? 60 })
    throw pluginError("plugin.rate_limited",
      { message: "fanart returned <status>", retryable: true })

  handleHttpStatus(res, "fanart")    # SDK helper, throws typed error on 4xx/5xx
  json = res.json()
  return shapeBundle(json, type, languages, ctx)


shapeBundle(json, type, languages, ctx):
  cdn = ctx.config.global.assetCdnPrefix
  KIND_KEYS:
    movie: { poster: "movieposter",   backdrop: "moviebackground",
             clearLogo: "hdmovielogo", thumb: "moviethumb" }
    tv:    { poster: "tvposter",      backdrop: "showbackground",
             clearLogo: "hdtvlogo",   thumb: "tvthumb" }

  out = { poster: [], backdrop: [], clearLogo: [], thumb: [] }
  ∀ kind ∈ ["poster", "backdrop", "clearLogo", "thumb"]:
    raw = json[KIND_KEYS[type][kind]] ?? []
    out[kind] = raw
      .map(entry → {
        url:      rewriteCdn(entry.url, cdn),    # replace assets.fanart.tv origin
        language: entry.lang || "00",
        likes:    Number(entry.likes) || 0
      })
      .sort(byLanguageThenLikes(languages))
      .slice(0, 5)
  return out


byLanguageThenLikes(languages):
  TAIL_INDEX = languages.length     # any value > max valid index works;
                                    # using length keeps it self-documenting
                                    # vs magic sentinel (99, Infinity, etc.)
  return (a, b) →
    # Match-tier first (preferred index ascending; -1 → tail).
    ai = languages.indexOf(a.language); bi = languages.indexOf(b.language)
    if ai != bi: return (ai == -1 ? TAIL_INDEX : ai) - (bi == -1 ? TAIL_INDEX : bi)
    # Within tier, more likes first.
    return b.likes - a.likes
```

### `@ent-mcp/plugin-tmdb` delta (pseudocode)

```
plugin.capabilities.artwork.getArtwork(ctx, { ids, type, languages }):
  tmdbId = ids.tmdb
  if ⊥ tmdbId:
    throw pluginError("plugin.input_invalid",
      { message: "tmdb plugin requires tmdb id", retryable: false })

  url = "https://api.themoviedb.org/3/" + (type == "movie" ? "movie" : "tv")
                                        + "/<tmdbId>/images"
  res = ctx.fetch(url, { headers: { Authorization: "Bearer <ctx.sharedCredentials.apiKey>" } })
  if res.status == 404: return emptyBundle()
  handleHttpStatus(res, "tmdb")
  json  = res.json()
  sizes = ctx.config.global.artworkSizes        # { poster, backdrop, logo }
  base  = ctx.config.global.imageBaseUrl        # "https://image.tmdb.org/t/p"

  buildUrl(size, path) → base + "/" + size + path

  map(arr, size):
    return (arr ?? [])
      .map(i → {
        url:      buildUrl(size, i.file_path),
        language: i.iso_639_1 || "00",          # null → textless
        likes:    Math.round((i.vote_average ?? 0) * 10),
        width:    i.width,
        height:   i.height
      })
      .sort(byLanguageThenLikes(languages))
      .slice(0, 5)

  return {
    poster:    map(json.posters,   sizes.poster),
    backdrop:  map(json.backdrops, sizes.backdrop),
    clearLogo: map(json.logos,     sizes.logo),
    thumb:     []                                # TMDB ⊥ thumb concept
  }
```

### Plugin registration

`apps/server/src/plugins/registry.ts` adds `fanartPlugin` to `BUILTIN_PLUGINS`.
`apps/server/src/plugin-runtime/register-capabilities.ts` adds `ArtworkV1` to capability registration list.

## Knock-on Changes

### `2026-04-22-home-feed-design.md` supersede

This doc supersedes:

- §4 `CompactMediaItem` — remove `poster`, `backdrop`, `clearLogo` fields. Comments referencing fanart fallback chain delete.
- §4 `LayoutHero.item` — same removal (hero is itself `CompactMediaItem`).
- §5 resolveHero — comment "compact.ts mapper prefers fanart.tv assets..." removed.
- §10 Open questions — "Add: fanart.tv access" entry resolved → reference this doc.
- §4 `@ent-mcp/shared/home` — `CompactMediaItem` shrinks; subpath export stays.

`compact.ts` mapper simplifies: drops every TMDB image-URL construction. ⊥ fanart awareness either. Pure text+ids+progress mapping.

`HomeFeedService` integration tests lose every assertion against `poster`/`backdrop`/`clearLogo` fields.

### Shared types: `@ent-mcp/shared/artwork` (new)

Per repo shared-package rules. New subpath at `packages/shared/src/artwork/`. Exports:

- `ArtworkBundle` — bundle shape (output of `artwork.get`).
- `ArtworkVariant` — single variant w/ url + language + likes + optional dimensions.
- `ArtworkIdMap` — `{ tmdb?, imdb?, tvdb? }` map.
- `ArtworkRequestItem` — `{ key, ids, type }`.
- `ArtworkGetResponse` — `{ results, errors?, generatedAt }`.
- `ArtworkError` — `{ code, message }` w/ code union.

Zod schemas server-internal (`apps/server/src/api/routes/artwork.ts`). Same pattern as home-feed cursor schemas.

### New `HOST_ERROR_CODES` entries

Under `packages/shared/src/errors/codes.ts`:

| Code                           | When                                                                                     | Captured? |
| ------------------------------ | ---------------------------------------------------------------------------------------- | --------- |
| `artwork.bad_input`            | Malformed input — missing ids, unknown type, malformed id pattern, extra keys, >50 items | No        |
| `artwork.unsupported_id_combo` | Zero providers can serve given (ids, type) — caller bug                                  | No        |
| `artwork.internal`             | Aggregate-level dispatch failure (rare); per-item, surfaced via `errors` map             | Yes       |

### Frontend integration boundary

This doc = server-side only. Frontend consumption deferred to `2026-04-23-home-feed-frontend-design.md` revision. Guidance for that revision:

- Skeleton/blur-up component while `artwork.get` pending.
- Intersection-observer batching: collect items entering viewport, debounce ~50ms, fire one `artwork.get` per batch, max 50 items.
- Hero rendered identically — ⊥ special server preflight (Q5a). Skeleton + fade-in transition.
- Image swap UX when fanart upgrade arrives after initial render.
- Locale signal: client passes `languages` from user pref once locale infra exists; server defaults `["en", "00"]` when absent.

Frontend integration ⊥ designed in this doc — bullets above = guidance for revision PR, ⊥ commitments here.

### Plugin connections UI

Existing `/connections` admin page (per `2026-04-19-frontend-connections-design.md` + `2026-04-22-frontend-plugin-connections-design.md`) gets fanart row automatic — new built-in plugin appears in `plugins` table after `bootstrapBuiltins` runs. Admin enters API key in shared-credentials slot. ⊥ new UI work.

### Notification events

None. Fanart plugin emits ⊥ notification events. Image lookups = background-class operations; failures degrade silent to TMDB | empty bundle.

### MCP surface

None. Agents already get artwork via `metadata@v1.getDetails`'s populated image fields. `artwork@v1` = dashboard-render-quality enrichment, ⊥ agent-relevant. Future `ent_artwork` deferred until MCP agents grow image-rendering surface.

## Migration Plan

Each commit independently reviewable, leaves repo in working state. Sequenced so home-feed image-field removal lands **after** `artwork.get` ships — clients ⊥ lose images during deploy gap.

### Pre-flight dependency

Plugin monorepo refactor (`2026-04-25-plugin-monorepo-design.md`) must merge first. Plan assumes `apps/`/`packages/plugins/*` layout, `@ent-mcp/plugin-sdk` exists. If monorepo lands later → work shifts to current `packages/server/src/plugins/builtin/` shape. Same logic, different paths.

### Commits

1. **Add `artwork@v1` capability + shared types + error codes.** New `packages/plugin-sdk/src/capabilities/artwork.ts` w/ schemas + `defineCapability`. Add to barrel `index.ts`. Widen `Strategy` type in SDK from flat enum to tagged-union; add `aggregate_per_kind` variant. Existing strategy callers (server-side dispatcher) migrate to tagged shape in same commit (single small change: `if (strategy === "aggregate")` → `if (strategy.kind === "aggregate")`). Add `ArtworkBundle`, `ArtworkVariant`, `ArtworkIdMap`, `ArtworkRequestItem`, `ArtworkGetResponse`, `ArtworkError` to `packages/shared/src/artwork/` w/ subpath export. Add `artwork.bad_input`, `artwork.unsupported_id_combo`, `artwork.internal` entries to `packages/shared/src/errors/codes.ts` `HOST_ERROR_CODES`. SDK self-tests for schema validation + strategy-tagged-union typing. Changeset: `@ent-mcp/plugin-sdk` minor + `@ent-mcp/shared` patch + `@ent-mcp/server` patch (strategy callsite migration).

2. **Implement aggregate dispatcher for `aggregate_per_kind`.** Server-side at `apps/server/src/plugin-runtime/strategies/`. Wire into existing dispatch. Unit tests cover priority ordering, per-kind merge, partial provider failure, all-providers-empty (negative cache), zero eligible providers (`artwork.unsupported_id_combo`). Changeset: `@ent-mcp/server` patch.

3. **Add `artwork@v1` to TMDB plugin.** New capability impl in `packages/plugins/tmdb/src/`. Manifest gains `artwork` capability + `artworkSizes` config. Contract tests in plugin's `__tests__/`. Changeset: `@ent-mcp/plugin-tmdb` minor.

4. **Create `@ent-mcp/plugin-fanart` package.** Per monorepo per-plugin-extraction template: `package.json`, `vite.config.ts`, `src/`, `__tests__/`. Add to `apps/server/package.json` deps. Register in `apps/server/src/plugins/registry.ts` boot list. Changesets: `@ent-mcp/plugin-fanart` minor (initial release) + `@ent-mcp/server` patch (consumer update).

5. **Add `MediaService.getArtwork` + `MediaService.resolveIds` + `ArtworkService` + `artwork.get` RPC route.** New `MediaService` typed methods (cache-and-dispatch wrapper for `artwork@v1`; batched wrapper around existing `idResolver`) at `apps/server/src/media-service/`. New `apps/server/src/artwork/index.ts` for `ArtworkService`. New `apps/server/src/api/routes/artwork.ts` for RPC. Wire into RPC router. Integration tests: per-item dedup, tmdb→tvdb preflight batching, partial errors, cache hits. Changeset: `@ent-mcp/server` minor.

6. **Capability cache flush on plugin enable/disable.** Hook into existing `plugin.enable`/`plugin.disable` admin endpoints — flush `artwork@v1` keyspace from MediaService cache when fanart | tmdb plugin state changes. Tests cover invalidation. Changeset: `@ent-mcp/server` patch.

7. **Drop image fields from `CompactMediaItem` + minimal client patch.** Edit `packages/shared/src/home/`. `compact.ts` mapper in `apps/server/src/home/` loses image plumbing. Update home-feed integration tests + delete now-irrelevant assertions. Update `2026-04-22-home-feed-design.md` per supersede list. **Client patch in this commit = skeleton-only render**: stop reading the now-removed `poster`/`backdrop`/`clearLogo` fields, replace render path w/ skeleton placeholder. ⊥ `artwork.get` consumption yet — that lands in step 8. Acceptable interim UX: home loads w/ skeleton-only artwork until step 8 deploys (typically same day | next deploy). Changesets: `@ent-mcp/shared` major (breaking) + `@ent-mcp/server` minor + `@ent-mcp/client` patch (skeleton-only).

8. **Frontend wiring — `artwork.get` consumption.** Home page calls `artwork.get`; lazy-load on viewport per Frontend integration boundary. Skeleton transitions to fanart/TMDB image when response lands. Tracked in separate frontend follow-up doc revision (`2026-04-23-home-feed-frontend-design.md` revision); ⊥ part of this server-side spec but called out so plan reader knows it exists. Changeset: `@ent-mcp/client` minor.

### PR groupings

- **PR 1:** SDK + dispatcher + TMDB capability (steps 1-3) — foundational, ⊥ client-visible behavior change.
- **PR 2:** Fanart plugin + ArtworkService + RPC + cache flush (steps 4-6) — `artwork.get` shippable, opt-in by client.
- **PR 3:** `CompactMediaItem` field drop + home-feed doc supersede (step 7) — coordinated server+client cutover.
- **PR 4:** Client lazy-load + skeleton (step 8) — separate frontend doc/PR.

### Risk & rollback

- **Step 7 breaking shape.** `CompactMediaItem` field removal = cross-package break. Step 7 only lands after step 5 ships `artwork.get` & step 8 (| interim client deploy) renders w/ skeleton fallback. Sequencing keeps no-fanart period from showing broken images. Revert: `git revert` step 7 restores fields; image plumbing in compact mapper still intact in revert.
- **Step 4 plugin extraction.** Independent revertable — revert removes fanart plugin entirely; aggregate dispatch falls back TMDB-only (already in place from step 3).
- **Step 2 dispatcher strategy.** New strategy variant additive — ⊥ touches existing `aggregate`/`primary_with_enrichment` paths. Rollback removes `aggregate_per_kind` branch; only `artwork@v1` consumes it.

### Estimated scope

~8 commits across 3-4 PRs. ~600-1000 lines net change, mostly mechanical (manifest declarations, schema definitions, plugin scaffolding from monorepo template).

### Day-in-the-life

**New artwork provider added (e.g. third-party `clearart-collective`).** Implement `artwork@v1` w/ own `supportedIdTypes` + `providerPriority`. Register. Aggregate dispatcher picks up automatic — ⊥ `ArtworkService` change.

**Fanart down/key revoked.** Aggregate dispatcher logs error from fanart provider, merges remaining TMDB result. Client sees TMDB-quality art only. ⊥ top-level RPC failure. Admin gets standard plugin-error notification per existing infra.

**Locale infra lands.** RPC route reads `ctx.user.locale` → passes as `languages: [locale, "en", "00"]` arg through `ArtworkService.getArtwork`. Cache key already locale-aware via `langPrefHash` → ⊥ migration. Existing cached entries stay valid for `["en", "00"]` callers; new locale picks up cache misses naturally. `ArtworkService` itself stays user-agnostic.

## Testing

One test file per unit. Favor small + fast unit tests over integration; one end-to-end path per critical user-state fixture.

### SDK self-tests (`packages/plugin-sdk/__tests__/`)

- `artwork.test.ts`: capability schema validates well-formed input/output; rejects empty `ids` map; rejects unknown `idType` values; rejects bundle exceeding 5 variants per kind.
- `manifestSpec` validates `supportedIdTypes` keys exactly `["movie", "tv"]`; rejects `providerPriority` outside [0, 1000].

### Dispatcher strategy tests (`apps/server/src/plugin-runtime/strategies/__tests__/aggregate-per-kind.test.ts`)

- Two providers, both return non-empty bundles → priority winner per kind.
- Higher-priority provider returns partial bundle (poster only) → lower-priority fills remaining kinds.
- Higher-priority provider throws → lower-priority result returned, error logged.
- All eligible providers return empty → empty bundle returned (cacheable negative).
- All eligible providers throw → empty bundle returned, errors logged, ⊥ cached.
- Zero eligible providers (canServe filter rejects all) → throws `artwork.unsupported_id_combo`.
- Provider priority tie → resolved by alphabetical plugin id.
- `canServe`: tv + only `tmdb` id → fanart ineligible (needs tvdb), TMDB eligible. Movie + only `imdb` → fanart eligible (accepts imdb), TMDB ineligible.

### Fanart plugin tests (`packages/plugins/fanart/__tests__/`)

- `contract.test.ts`: drives `getArtwork` end-to-end against fixture fanart payloads via stubbed `PluginContext`. Asserts URLs match fanart endpoints; output validates against `artwork@v1` output schema.
- Movie + tmdb id → bundle w/ all four kinds when fixture rich; sorted by language pref then likes; capped at 5 per kind.
- Movie + imdb id → uses imdb path.
- TV + tvdb id → tv kinds.
- 404 → empty bundle, ⊥ throw.
- 429 → `pool.markExhausted` called w/ retry-after parsed from header (defaults 60s when header absent), throws retryable.
- 503 → same as 429 path.
- 500 → throws non-retryable host-error via `handleHttpStatus`.
- Defensive guard: caller bypasses dispatcher & invokes plugin w/ id missing → throws `plugin.input_invalid`.
- Asset CDN override: `assetCdnPrefix` config rewrites payload URL origin.
- Sort: `["en", "00"]` pref → en variants first, 00 next, others tail; within tier likes desc; ties stable.
- Niche title fixture w/ only `movieposter` populated → other kinds empty arrays.
- Manifest-level: `supportedIdTypes` matches plugin's actual id handling; lockstep test (manifest declares tvdb for tv, plugin throws if invoked w/o tvdb on tv).
- Malformed response: fanart returns 200 w/ HTML body | invalid JSON → throws non-retryable host-error; ⊥ leak unparsed payload in error message.

### TMDB plugin delta tests (`packages/plugins/tmdb/__tests__/artwork.test.ts`)

- Movie tmdb → poster + backdrop + clearLogo populated, thumb empty.
- TV tmdb → same w/ tv path.
- 404 → empty bundle.
- TMDB `iso_639_1: null` (textless) → mapped to `"00"`.
- TMDB `vote_average` mapped to `likes` for cross-provider sort consistency.
- Default `artworkSizes` config → URLs use `w780`/`w1280`/`w500`.
- Custom config override → URLs use overridden sizes.

### `ArtworkService` integration tests (`apps/server/src/artwork/__tests__/artwork-service.test.ts`)

- **Single movie item, tmdb id present** → fanart + TMDB both invoked, fanart wins per kind, bundle returned keyed by client `key`.
- **Single tv item, tmdb id only** → preflight batch idResolve fires, tvdb populated, fanart eligible, bundle returned.
- **Single tv item, tmdb id only, idResolve returns no tvdb** → fanart skipped, TMDB serves alone, bundle has TMDB poster/backdrop/clearLogo, empty thumb.
- **Single tv item, only imdb id** → both fanart & TMDB ineligible (fanart wants tvdb for tv; TMDB wants tmdb), `errors[key] = "unsupported_id_combo"`, ⊥ top-level throw.
- **Batch of 50 items, mixed types, mixed id coverage** → in-request dedup collapses identical canonical keys; preflight batches all needed tvdb resolutions in one call; final response keyed by every original client `key` even when canonical entries collapsed.
- **Two client keys → same canonical (idsHash, type)** → single artwork@v1 dispatch; both client keys receive same bundle.
- **One item errors at dispatch level (aggregate failure), rest succeed** → `errors[failingKey]` set, `results` carries others, top-level RPC stays 200.
- **Cache hit** → second call w/ identical canonical input returns cached bundle, ⊥ provider invocation. Verified via call-count spy on underlying plugin invocation (assert each provider's `getArtwork` impl called exactly once across two service calls).
- **Negative cache** → fixture w/ both providers returning empty → empty bundle cached, second call hits cache.
- **Different `languages` arrays** → distinct cache keys; ⊥ false sharing.

### RPC contract tests (`apps/server/src/api/routes/__tests__/artwork.test.ts`)

- Input schema: rejects empty `items`; rejects >50 items; rejects unknown `type`; rejects malformed id patterns; rejects extra keys (strict).
- Output shape matches published `@ent-mcp/shared/artwork` types; snapshot test on canonical fixture.
- Unauthenticated request → 401; auth pattern matches `home.getLayout`.
- Per-item `key` echoed back in `results` keys exactly.

### Capability cache invalidation tests

- Fanart plugin disabled via `plugin.disable` → `artwork@v1` keyspace flushed; next request re-dispatches against TMDB only.
- Fanart plugin re-enabled → next request dispatches against both providers; cache rebuilds from misses.
- TMDB plugin disabled → `artwork@v1` keyspace flushed; next request dispatches against fanart only.

### Home-feed regression tests

After step 7 (CompactMediaItem field drop):

- `compact.ts` mapper output schema ⊥ carries `poster`/`backdrop`/`clearLogo`.
- Existing home-feed integration tests strip image-field assertions; new test asserts `CompactMediaItem` shape matches updated shared type.
- `LayoutHero.item` shape mirrors `CompactMediaItem` shape — confirmed via type-level check.

### Not tested here

- Frontend skeleton/blur-up rendering, viewport-batching of `artwork.get` calls — frontend follow-up spec.
- TMDB | fanart upstream behavior — vendor concerns.
- Plugin runtime sandboxing, host-bridge, fetch policy — runtime suite owns these.
- `idResolve@v1` aggregate correctness — covered by existing TVDB plugin tests + plugin-architecture-doc test plan.
- Job-service interaction — ⊥ jobs declared by this plugin.

## Open Questions / Deferred

- **Locale-aware language preference.** `["en", "00"]` server default v1. Once user-locale infra lands, RPC route resolves user pref + passes as `languages` arg through `ArtworkService.getArtwork`. Cache keying already locale-aware via `langPrefHash` — additive change. `ArtworkService` stays user-agnostic; user-pref resolution lives at route layer.
- **Image proxy / CDN-fronting.** Direct CDN URLs only v1. If TMDB/fanart latency | CORS becomes user-visible problem → add `/api/artwork/img` proxy w/ Cloudflare cache layer. Plugin output unchanged — proxy rewrites URLs at RPC-response time.
- **Per-render-context size negotiation.** TMDB serves arbitrary sizes via path segment (`w500`, `w780`, `original`). Client requests larger via URL swap when needed. Capability output v1 ships single size per kind (admin-config-driven). Future: response carries size variants array, client picks.
- **Third-party artwork providers.** `artwork@v1` capability designed for plugin-author extension. Future plugins (`clearart-collective`, `themoviedb-fanart-bridge`, etc.) implement same shape, declare `supportedIdTypes` + `providerPriority`. Aggregate dispatcher absorbs them w/o `ArtworkService` change.
- **Background warm queue.** Dropped per Q4 final lock. Re-add if (a) fanart hit latency on first viewport entry feels slow, AND (b) usage analytics show predictable cold misses (e.g. trending titles spike). Job-service infra ready — additive, ⊥ spec change.
- **Hero-specific server-side preflight.** Q5a locked client-side resolution for hero. If first-paint UX visibly bad → ~200ms server-side preflight for hero only is clean retrofit. `ArtworkService.getHero(item)` method, called from `home.getLayout` end of pipeline, populates `LayoutHero.artwork` directly. Bounded blast radius — affects single item, ⊥ full feed.
- **Cross-row dedup.** Capability cache + `ArtworkService` in-request dedup handle duplicate-call case. Item shown in two rows = one artwork dispatch. Already covered.
- **MCP `ent_artwork` tool.** Agents currently get image URLs via `metadata@v1.getDetails` populated fields. Dedicated tool deferred until MCP agents grow image-rendering surface.
- **Multi-region admin pools.** Current `poolable: true` rotates on rate-limit signal. Geographic rotation (admin running media-manager in EU vs US wants region-pinned keys) deferred — same pool primitive supports w/ admin-side annotation; ⊥ change in plugin.
- **Fanart project-key (paid) vs personal-key freshness.** Personal keys serve ~1-week-stale data per fanart docs. Pool-rotation treats both key types identically v1. Future: per-key metadata letting host prefer project-key when admin configured both. Out of scope here.
- **Image variant moderation.** Fanart payloads include user-uploaded art; some titles have NSFW | low-quality variants. v1 takes top-likes ranking as proxy for quality. Future: admin block-list per item | per-uploader-id. Cache keying agnostic to filter — additive.
- **TMDB attribution requirement.** TMDB ToS requires attribution when using their images. Frontend follow-up must surface "this product uses the TMDB API" line on pages rendering TMDB-sourced artwork. Out of scope this doc but flagged.
- **IMDB-only movie items.** Movie w/ only `imdb` id (no `tmdb`) → fanart eligible (accepts imdb), TMDB ineligible (needs tmdb). Fanart 404 → fall through fails because no second provider can serve. `preflightTvdbResolution` handles tv-side gap (tmdb → tvdb); ⊥ symmetric `preflightTmdbResolution(imdb)` for movies. In practice rare — `id_map` opportunistic population means most items carry both ids by the time they reach client. Edge case lives on fresh installs | items never fetched via `metadata@v1`. If signal grows: add imdb→tmdb preflight branch alongside tmdb→tvdb.
- **Thundering-herd on cache flush.** Plugin enable/disable flushes whole `mv:artwork:v1:*` keyspace. Concurrent in-flight + immediately-subsequent requests all miss cache simultaneously → spike to fanart/TMDB. Pool rotation handles rate-limit reactively (`pool.markExhausted` w/ retry-after) but ⊥ proactively. Mitigations if signal grows: (a) staggered TTL re-warm via background job, (b) request coalescing at MediaService layer (single-flight key → multiple awaiters share one upstream call). Neither needed v1; capability flush events = rare admin actions.

## References

- `2026-04-19-plugin-architecture-design.md` — runtime, capability model, manifest schema, derived validation rules, idResolve scope behavior. Authoritative for everything this doc ⊥ redefine.
- `2026-04-25-plugin-monorepo-design.md` — packaging shape, SDK contents, per-plugin extraction template, `@ent-mcp/shared` rules.
- `2026-04-22-home-feed-design.md` — supersedes §4 image fields per Knock-on Changes.
- `2026-04-23-home-feed-frontend-design.md` — frontend integration boundary; revision pending after this lands.
- `2026-04-19-error-management-design.md` — `HOST_ERROR_CODES` registration pattern, `UserFacingError` shape.
- Fanart.tv API docs: https://fanart.tv/api-docs/api-v3/
- TMDB images endpoints: https://developer.themoviedb.org/reference/movie-images, https://developer.themoviedb.org/reference/tv-series-images

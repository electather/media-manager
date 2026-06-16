# Library Backend Design

Date: 2026-06-02. Status: approved, pre-impl.

> Style note: doc written ultra-terse + compressed pseudo-code by request. All substance kept; prose stripped. Pseudo-code = shorthand (`→` flow/causality, `?` nullable, `pk/fk/uq` keys, `←` sourced-from). Not literal TS.

## Goal

FE library page exists, mock data only. Build BE → wire FE to real data. 5 browse lenses. Priority: max code-share w/ `media`/`home`/`watchlist`.

## Decisions (locked)

| # | Topic | Choice |
|---|---|---|
| D1 | Item set | Owned collection ← `collection@v1.getCollection` |
| D2 | Collections lens | Owned-only TMDB franchise grouping (`belongs_to_collection`) |
| D3 | Read model | Paginated lens sources via `media.listRows` |
| D4 | Persistence | Denormalized `library_items` read-model tbl + hydrate job |

FE = mock-only → its *look* is truth, its data-fetch is not. Rewire FE data layer; keep components.

## Non-goals

Full-franchise w/ unowned gaps (owned-only). Filter-aware facet counts (totals only, matches mock). User-curated collections. Write ops (add/remove owned) — read-only v1.

---

## Architecture — thin product shell over `media` (watchlist sibling)

```
apps/server/src/library/
  index.ts                 # barrel = public API only (fallow boundary)
  service.ts               # thin: facets summary, collections grouping
  internal/
    context.ts             # buildCtx → {MediaService, CatalogService, StatusBatchMemo}
    media-sources.ts       # libraryMediaSources registry (4 lens regs)
    facets.ts              # facet-count agg (SQL GROUP BY)
    collections.ts         # group-first franchise logic
    hydrate.ts             # denorm hydrate (catalog + availability + progress → cols)
  sources/{az,timeline,server,quality}.ts   # 1 MediaSource per lens
  sources/keyset.ts        # lens cursor codecs (mirror watchlist/sources/keyset.ts)
  jobs/sync-library.ts     # collection@v1 → membership + hydrate
  errors.ts  events.ts  __tests__/
db/schema/library/library-items.ts   # library-owned tbl
```

Library owns its tbl (distinct owned-set; `media` core untouched). Reuse: `listRows`, enrich, classify, cursor, `Page`, registry, sync-job pattern. Run `backend-feature-architecture` skill @ impl.

Boundaries (fallow): `server-mod-library` (barrel only out), `server-mod-library-internal` (sources/repo/hydrate). Import `media` barrel only — never media internals.

---

## Data model

### `library_items` (denorm browse projection)

```
library_items tbl {
  id pk                                    # composite "movie:550"
  userId fk→user cascade
  tmdbId ; mediaType:enum MEDIA_TYPES
  owned bool=T ; ownedAt ; unownedAt?      # lifecycle, tombstone (no-resurrect, watchlist pattern)

  # --- denorm sort keys ← canonical_metadata ---
  sortTitle="" : str                       # normalized: articles stripped, lowercased, diacritics fold
  year? : int                              # release year

  # --- denorm facet/filter keys ---
  genres : json[str] = []
  servers : json[{id,label}] = []          # ← libraryAvailability@v1
  qualityTiers : json[str] = []            # ← libraryAvailability@v1 quality copies
  watchedState? : enum WATCHED_STATES      # watched|partial|unwatched ← progress

  # --- franchise (collections lens) ---
  collectionId? ; collectionName?          # TMDB belongs_to_collection

  hydratedAt? : int                        # denorm freshness marker

  idx:
    uq(userId, tmdbId, mediaType)
    (userId, owned, sortTitle, id)         # az keyset
    (userId, owned, year, id)              # timeline keyset
    (userId, owned, collectionId)          # collections group
  # servers/qualityTiers multi-valued → facet/filter via json_each
}
```

`servers`/`qualityTiers` multi-valued: item on Plex+Jellyfin in 4K+1080p → 1 row, arrays hold all. Server/quality lenses expand via `json_each` → item appears per matching section.

### Franchise threading (D2) — orthogonal, needed for collections lens

TMDB `/movie/{id}` already returns `belongs_to_collection` → no extra call. Thread through existing metadata→catalog pipeline:

```
tmdb MovieRaw         + belongs_to_collection?:{id,name,poster_path,backdrop_path}
tmdb mapMovie()       → emit collection:{id:str,name:str} | null   (movies only; TV→null)
shared mediaItem zod  + collection?: {id,name}.nullable()
CanonicalMetadata     + collectionId:str|null  + collectionName:str|null
canonical_metadata tbl + 2 cols (migration)
catalog toCanonicalRow() → persist from mediaItem.collection
```

---

## Sync + hydrate — 1 job, mirror watchlist

`jobs/sync-library.ts` → `library.sync` (cron `0 */6 * * *` + eager-seed on first read, seed-lock):

```
sync(userId):
  # phase 1: membership
  feed = dispatchAggregate(collection@v1.getCollection, {})   # library = 1st consumer of this cap
  known = allKnownKeys(userId)
  upsert owned rows ∀ feed∌known                              # owned=T, ownedAt=parseEpoch(entry.addedAt)  // addedAt = ISO str
  tombstone ∀ known∌feed                                      # owned=F, unownedAt=now (no resurrect)

  # phase 2: hydrate denorm (new + stale rows)
  rows = staleOrNew(userId)                                   # hydratedAt null | older than TTL
  meta = catalog.getMetadataBatch(keys)    → sortTitle, year, genres, collectionId/Name
  # avail NOT free: listAvailable → {tmdbIds} presence ONLY (no server id, no quality).
  #   server id   ← getMatchingServers/probeServer (existing path)
  #   quality     ← checkAvailability PER item → items[].quality (getMatchingServers DISCARDS quality)
  #   ∴ qualityTiers hydrate = N-call fan-out (N = owned titles × providers). OK in bg job, not a free ride.
  #   ↳ #597: fan-out now bounded — rows hydrate in chunks of HYDRATE_CONCURRENCY (25), ≤2×25 plugin calls in-flight (see ledger 12).
  servers      ← getMatchingServers(key)
  qualityTiers ← checkAvailability(key).items[].quality       # N-call fan-out
  prog = loadProgressMap(keys)             → watchedState
  write cols ; set hydratedAt=now
```

Cadence: membership 6h. Availability re-hydrate hourly (staleness window = A's cost). Eager-seed = membership-only fast path on first read; hydrate lazy/async.

`collection@v1` dispatched nowhere today → new `MediaService.getCollectionFeed()` wrapper (mirror `getWatchlistFeed`).

---

## The 5 lenses

| Lens | Endpoint | Res shape | Sort / cursor |
|---|---|---|---|
| A–Z | `GET /api/media/sources/library-az` | `Page<CompactMediaItem>` | keyset `(sortTitle, id)` |
| Timeline | `…/library-timeline` | `Page` | keyset `(year DESC, id)` |
| Server | `…/library-server` | `Page` | keyset `(server, sortTitle, id)`, json_each |
| Quality | `…/library-quality` | `Page` | keyset `(tierRank DESC, sortTitle, id)`, json_each |
| Collections | `GET /api/library/collections` | `{collections:[{id,title,count,preview:CompactMediaItem[≤4]}], cursor}` | group-first by `collectionId` |

### Item lenses (az/timeline/server/quality) — unified registry

Register in `media` unified `REGISTRY` → served by **existing** `GET /api/media/sources/:sourceId`. Zero new read-routing.

```
# 1 MediaSource per lens. SQL pre-sorts → stages.sort="none".
azSource: MediaSource<LibraryLensParams, LibraryRow> {
  sourceId: "library-az"
  fetchRawSet(ctx, params, cursor):
    rows = SQL select from library_items
           where userId AND owned AND <filters(params)>
           [keyset (sortTitle,id) > cursor]
           order by sortTitle, id  limit N+1
    → { rows, partial:F, nextRaw: rawToken(last) }
  stages: { sort:"none", cursorMode:"keyset" }    # filter applied in SQL, not pipeline
}

# registration (mirror watchlist itemsRegistration):
libraryMediaSources = {
  "library-az":       reg(azSource,       paramSchema, cursorMode:"keyset", rateLimit:"read")
  "library-timeline": reg(timelineSource, …)
  "library-server":   reg(serverSource,   …)
  "library-quality":  reg(qualitySource,  …)
}
# api/procedures/media.ts:
REGISTRY = { ...homeMediaSources, ...watchlistMediaSources, ...libraryMediaSources }
```

server/quality SQL (multi-valued):

```
select li.* from library_items li, json_each(li.servers) sv
where userId AND owned AND <filters>
[keyset (sv.value->>'id', sortTitle, id) > cursor]
order by sv.value->>'id', sortTitle, id  limit N+1
# row dup per server → that's intended (item in each server section)
```

quality: same w/ `json_each(qualityTiers)`, order by `rankQualityTier(value) DESC`.

### Cursor codecs (`sources/keyset.ts`) — mirror watchlist

```
# per-lens token. reuse Cursor {mode:"keyset", k:str}, decode never throws.
azToken(row)       = `${sortTitle} ${id}`
timelineToken(row) = `${year ?? 0} ${id}`
serverToken(row,sv)= `${sv.id} ${sortTitle} ${id}`
qualityToken(...)  = `${tierRank} ${sortTitle} ${id}`
decodeX(cursor) → fields | undefined   # bad/foreign → undefined → first page
```

### Enrich — custom `enrichRows` path (home pattern), availability from denorm (no re-probe)

MUST use `enrichRows` hook, NOT default `batchLoad`+`enrich`. Default re-probes availability live (`getMatchingServersCached`) → defeats denorm; AND collapses to 1 item per `(tmdbId,mediaType)` → kills json_each fan. enrichRows reads denorm cols.

```
listRows(librarySource, cfg, ctx, enrichRows)
  → fetchRawSet → page rows (library_items; server/quality = json_each-expanded, dup per value)
  → enrichRows(rows):
       title/year/poster/backdrop/genres/overview ← catalog (batchLoad)        # reuse
       status, progress, watchedState              ← batchLoad / denorm        # reuse
       availability.servers, tags(quality)         ← row.servers/qualityTiers  # denorm, NO re-probe
  → classify (reuse)  → sort:"none"  → paginate(keyset)
```

server/quality dup rules (az/timeline = 1 row/item, no dup):
- page `limit` counts EXPANDED rows (item×value), not distinct titles.
- enrichRows MUST NOT dedup/collapse on `id` → 1 CompactMediaItem per expanded row; same title repeats across sections (intended).
- keyset tuple unique per expanded row (`(server,sortTitle,id)` / `(tierRank,sortTitle,id)`) = monotonic → cursor stable.

Page touches O(page) — SQL filter/sort by index. No whole-set materialize.

### Collections lens — group-first (`/api/library/collections`)

```
GET /api/library/collections?cursor&limit&<filters>
  groups = SQL select collectionId, collectionName, count(*),
                  group_concat preview ids (≤4)
           from library_items
           where userId AND owned AND collectionId NOT NULL AND <filters>
           group by collectionId  order by collectionName  [keyset]  limit N+1
  preview = enrich(previewIds) → CompactMediaItem[≤4]      # for poster fan
  → { collections:[{id:"collection:<tmdbCollId>", title, count, preview}], cursor }
```

Owned-only → only franchises w/ ≥1 owned movie. Standalone/TV → collectionId null → excluded.

### Facets (`/api/library/facets`)

```
GET /api/library/facets   # unfiltered totals (matches mock look)
  → {
      kinds:   {movie:n, tv:n}                     # GROUP BY mediaType
      genres:  {<g>:n}                             # json_each(genres) GROUP BY
      qualities:{<q>:n}                            # json_each(qualityTiers)
      servers: {<s>:n}                             # json_each(servers)
      watched: {watched:n, partial:n, unwatched:n} # GROUP BY watchedState
      letters: ["A".."Z","#"]                      # distinct first-char(sortTitle) — az rail
      decades: [2020,2010,…]                       # distinct (year/10*10) DESC — timeline
    }
  cache short-TTL, invalidate on sync.
```

---

## Shared pkg `@nama/shared/library` — mirror watchlist

```
packages/shared/src/library/
  enums.ts:
    LIBRARY_LENSES = ["az","timeline","collections","server","quality"] as const   # move from client
    WATCHED_STATES = ["watched","partial","unwatched"] as const                    # move from client
    QUALITY_TIERS  = [ordered hi→lo] as const                                      # rank ref
  types.ts:
    LibraryCollection = {id, title, count, preview: CompactMediaItem[]}
    LibraryFacetCounts = {kinds,genres,qualities,servers,watched,letters,decades}
    LibraryCollectionsResponse = {collections: LibraryCollection[], cursor: str|null}
    # lens res = media Page (reuse, no new type)
  schemas.ts (zod):
    libraryLensQuerySchema = {cursor?, limit≤200=60, kinds[]?, genres[]?, qualities[]?, servers[]?, watched[]?}
    libraryCollectionsQuerySchema = {cursor?, limit?, ...filters}
  index.ts: export * from enums/types/schemas
```

`packages/shared/package.json` exports: `+ "./library": "./src/library/index.ts"`.

Filters = query params → SQL `WHERE` (kinds=mediaType IN, genres/qualities/servers=json_each EXISTS, watched=watchedState IN). Empty axis → no filter.

---

## API routes

```
api/router.ts: + .route("/library", libraryApp)
libraryApp = Hono().use(requireSession)
  .get("/collections", zValidator(query), → service.listCollections)
  .get("/facets",      → service.getFacets)
# item lenses NOT here → unified /api/media/sources/:sourceId (registry)
rateLimit: reuse read TokenBucketLimiter bucket
```

---

## FE rewire (data layer only — look preserved)

Grid/tabs/filter-popover layout unchanged (same `CompactMediaItem`). Card = net-new quality-tag chip render (`tags` was always-undefined in mock → rendered nothing). Swap data:

```
hooks/use-library-content.ts → per-lens useInfiniteQuery:
  az/timeline/server/quality → api GET /media/sources/library-<lens> {cursor, ...filters}
  → flat sorted item stream; client inserts section header on group-key change
collections lens → api GET /library/collections
facets → useQuery /library/facets → popover badges + az letter rail + timeline decades
filters (URL search params) → query params on lens req
query-keys: per-lens + filter params
DELETE: __fixtures__ mock + fetchLibrary() stub + lib/grouping (server groups now)
ADD: infinite scroll → reuse virtualized-card-grids (docs/2026-05-21)
KEY: server/quality lens repeats a title per section → list key = id+section (not id alone)
```

Run `frontend-feature-architecture` skill @ impl. infinite scroll = new vs current "fetch-all"; look same (grid identical).

---

## Cache / errors / tests

**Cache**: facets + collections short-TTL, invalidate on sync. Lens pages → SQL + batchLoad caches.

**Errors**:
- plugin fan-out fail → `Page.partial=T` (pipeline supports). enrich tolerates null meta.
- no `collection@v1` provider → empty library, eager-seed no-op, FE empty state.
- typed `errors.ts` + reuse api error mapping.

**Tests** (Rule 9 — encode intent):
- sync: diff upsert/tombstone idempotent; tombstone NOT resurrected next sync.
- hydrate: cols populated ← catalog+avail+progress; stale → re-hydrate.
- lens: each sort/keyset stable across page boundary; filters applied; multi-server item appears in BOTH server sections (json_each).
- facets: counts correct incl json_each multi-valued; letters/decades present-only.
- collections: owned-only; preview ≤4; pagination; TV/standalone excluded.
- franchise: belongs_to_collection mapped+persisted; TV→null.
- FE: lens hook → correct source+params; section-header insert; filter round-trip; infinite scroll fetches next cursor.

---

## Code-share scorecard (priority)

**Reused**: `media.listRows`/enrich/classify/batchLoad · cursor + `Page` · `MediaSourceRegistration` + unified REGISTRY + `/api/media/sources` route · sync-job pattern (seed/sync + cron + eager-seed) · repo keyset mechanics · catalog metadata pipeline · virtualized grid · shared-subpath + feature-arch conventions.

**New (justified)**: `library_items` denorm tbl + repo · 1 sync/hydrate job · 4 lens sources + codecs · facets agg · collections endpoint · `@nama/shared/library` · franchise threading · FE data-layer swap.

---

## Phasing

| Ph | Scope | Shippable |
|----|-------|-----------|
| 1 | shared/library + `library_items` tbl + `.fallowrc.json` zones (`server-mod-library` + `-internal`) + franchise threading (metadata→catalog) + sync (membership) | ✓ |
| 2 | hydrate denorm + az/timeline sources + registry wiring + facets endpoint | ✓ |
| 3 | server/quality (json_each) + collections endpoint | ✓ |
| 4 | FE rewire (real endpoints, drop mock, infinite scroll) | ✓ |

### Changesets (per CLAUDE.md)

```
@nama/client     minor   # library page now backed by real data
@nama/server     minor   # added a media library browser
@nama/plugin-sdk minor   # metadata items can carry collection membership
@nama/plugin-tmdb minor  # tmdb reports movie franchise/collection
# shared = internal, never listed
```

1 logical change per file. End-user language, past tense.

---

## Known fuzzy areas (Rule 12)

- **Quality tier rank**: `qualityTiers` = free-form plugin strings ("4K HDR","Atmos","1080p") not fixed enum. Quality lens needs hi→lo fidelity order → `rankQualityTier(label)` heuristic: 2160p/4K > 1080p > 720p > SD; HDR/DV/Atmos = modifiers; unknown → bottom. Inexact by nature. `QUALITY_TIERS` tuple = canonical anchor.
- **Facets unfiltered**: counts = totals, not filter-aware. Matches mock. Flip later if wanted.
- **Collections shape**: return `preview:CompactMediaItem[≤4]` not mock's `itemIds:string[]` → card fans posters w/o 2nd fetch. Minor FE type change.
- **Eager-seed latency**: first-ever read blocks on collection@v1 membership fetch. Hydrate async after → first paint may show un-hydrated rows (no servers/quality/franchise). Acceptable; FE skeleton covers.

---

## Implementation status

### Phase 1 — done (✓ shippable)

Shipped: `@nama/shared/library` subpath (`LIBRARY_LENSES`/`WATCHED_STATES`/`QUALITY_TIERS` + types + zod schemas), `library_items` + `user_library_seed` tables (migration `0004_ordinary_whizzer.sql`), fallow zones (`server-mod-library` / `-internal` / `server-schema-library`), franchise threading (tmdb `belongs_to_collection` → `mapMovie` → mediaItem zod → `CanonicalMetadata.collectionId/Name` → `canonical_metadata` 2 cols → `toCanonicalRow`), `MediaService.getCollectionFeed()`, membership sync job (`library.sync`, cron `0 */6 * * *`). Tests: sync idempotent/no-resurrect/no-wipe, tmdb mapping, catalog persist. Changesets: server, plugin-tmdb, plugin-sdk.

Deviations from the sketch above (all deliberate):
- **Drizzle lives in `repo.ts`, not `internal/{facets,collections,hydrate}.ts`.** The `backend-feature-architecture` skill (Rule 2) is authoritative over the doc's pseudo-layout: the "SQL in internal/" lines are shorthand; real queries are in `repo.ts` (→ `repo/` dir once it grows). `internal/`/`sources/` orchestrate and call repo.
- **`CanonicalMetadata.collectionId/collectionName` are `?: string | null`** (optional) to keep the change non-breaking across ~15 existing literals. Data still always flows (toCanonicalRow emits both).
- **Tombstone sweep runs only on a COMPLETE, non-empty feed.** The phase-1 pseudo-code's unconditional `tombstone ∀ known∌feed` would wipe the entire owned library on a transient all-providers outage or a disconnected provider (empty/partial feed). The sweep is now guarded by `!partial && feedKeys.length > 0`, matching the doc's own §Errors "no provider → eager-seed no-op" intent. Trade-off: a collection legitimately emptied to exactly zero is not swept (a no-op per design).
- **`writeMetadata` conflict-UPDATE now sets `collectionId/collectionName`** (was insert-only) so franchise data learned on a metadata re-fetch persists.
- **`worker.ts` intentionally does NOT register `library.registerJobs()`** — croner cron jobs cannot run in the Workers isolate (test-pinned carve-out; sibling `watchlist.sync` is likewise excluded). Wired in `index.ts` only.
- **Deferred to later phases**: `events.ts` (cache invalidation — phase 2 when a facets cache exists); the eager-seed call-site (`trySeedLock`/`clearSeedLock` infra exists, but no read endpoint exists yet to trigger first-read seeding — wire in phase 2); the client tuple move + `QUALITY_TIERS` reconciliation (phase 4 FE rewire).

### Phase 2 — done (✓ shippable)

Shipped: `repo/` promoted to a dir (`membership`/`seed`/`hydrate`/`lens-pages`/`facets` + barrel); denorm hydrate (`internal/hydrate.ts` → catalog `getMetadataBatch` + `getMatchingServers` + new `MediaService.getAvailabilityQuality` quality fan-out + `loadProgressMap`); az + timeline `MediaSource`s with keyset codecs + `enrichRows` reading denorm (no re-probe, no collapse) wired into the unified `REGISTRY` (served by existing `/api/media/sources/:sourceId`); `GET /api/library/facets` (unfiltered totals, json_each multi-valued, present-only letters/decades) with a 60s per-user cache busted on sync; eager-seed-on-first-read on the lens path; second cron `library.hydrate` (hourly) for availability staleness. `library-az`/`library-timeline` added to `MEDIA_SOURCE_IDS`.

Deviations / fixes (adversarial verify caught 2 paging blockers + 1 facet bug, all fixed + regression-tested):
- **Lens keyset cursor** now encodes the *last returned* row, not the dropped `limit+1` overflow row (the overflow encoding silently skipped exactly one row per page on both lenses).
- **Timeline `ORDER BY`** uses `COALESCE(year,0) DESC` to match the cursor predicate (raw `year DESC` is NULLS-last in SQLite and disagreed with the `COALESCE` predicate → dropped/duplicated undated rows at the page boundary).
- **Facet json_each counts** use `count(DISTINCT id)` so a row with a duplicated array value (dirty metadata) counts once.
- **`watchedState` is sparse (known limitation).** It is derived from `loadProgressMap`, which only surfaces *active, unfinished* continue-watching entries — so `partial` populates but `watched` (fully played) is unreachable and never-started maps to `null`. The `watched` facet/filter axis is therefore near-empty in phase 2. Proper fix (followup): source a played/`watchHistory@v1` signal to populate the full three-way axis. Surfaced rather than silently shipped.
- **Multi-value filter axes** (`?genres=A&genres=B`) were collapsed to the first value through the unified `c.req.query()` resolver; the encoding is repeated params, resolved in the §E parity followup (ledger entry 15) — the resolver reads the multi-value-flattened map via `c.req.valid("query")` and the lens schema's array axes accept the repeated values.
- **`getAvailabilityQuality`** added to `MediaService` (the one media touch) — `getMatchingServers` discards `items[].quality`, so the quality fan-out needed its own public method.

### Phase 3 — done (✓ shippable)

Shipped: server/quality `json_each` lenses (`sources/{server,quality}.ts` + `repo/lens-pages` `selectServerPage`/`selectQualityPage` + grouped keyset codecs, `CompactMediaItem.section` surfacing, `library-server`/`library-quality` in `MEDIA_SOURCE_IDS` + the unified `REGISTRY`); and the group-first collections endpoint — `repo/collections.ts` (`selectCollections`/`selectRowsByIds`), `service.listCollections`, and `GET /api/library/collections` (`requireSession` + the shared read `TokenBucketLimiter`).

Collections endpoint detail:
- **Owned-only + TV/standalone excluded enforced in SQL.** The grouping WHERE scopes to `owned = true` AND `collection_id IS NOT NULL`, so a franchise surfaces only with ≥1 owned movie and standalone/TV (null `collection_id`) never appears.
- **Per-group preview (≤4) via a correlated subquery, NOT a bare `group_concat`.** SQLite `group_concat` cannot order-and-limit per group, so each group's preview ids are selected in an inner `ORDER BY sort_title, id LIMIT 4` subquery and concatenated in the outer one. Preview order is documented as `(sortTitle, id)` ascending (same as the A–Z lens) so the poster fan is stable run-to-run.
- **Keyset on `(collection_name, collection_id)`, phase-2 discipline applied.** The next cursor encodes the LAST RETURNED group (never the dropped `limit+1` overflow group), and the cursor predicate compares the SAME `(collection_name, collection_id)` the `ORDER BY` uses — no group dropped/duplicated at a page boundary. The cursor is an opaque `"<name> <id>"` token (`internal/collections-cursor.ts`), split on the last space (id is space-free), total-decode (bad/foreign → first page, never 400) — mirroring the lens keyset codecs. This endpoint mints its own cursor because it does NOT ride the media `paginate` stage.
- **Preview enrich reuses the lens dedup-free `buildEnrichRows`** in ONE batch for the whole page (one metadata/progress round trip, not one per franchise) — reads the denormalized `servers`/`qualityTiers`, no availability re-probe. A preview id whose metadata could not resolve is dropped from the fan rather than rendering a blank card.
- **Eager-seed on first read only.** A no-cursor read seeds membership via the same `ensureSeeded` path the lenses use; a paged-into read skips the seed-lock round trip.
- **`ROW_COLUMNS` + `ownedFilterConditions` exported from `repo/lens-pages`** so the collections repo selects the identical `LibraryRow` projection and applies the identical owned + filter predicate (one source of truth; the filter axes behave the same on every lens).

Deviations / fixes (adversarial verify caught a keyset blocker, a tenancy gap, a filter-leak, and a latent multi-tenancy bug — all fixed + regression-tested):
- **Multi-tenancy PK fix (the load-bearing one).** `library_items.id` was a single global `text PRIMARY KEY`, but `id` is `"<mediaType>:<tmdbId>"` (no user) — so two users owning the same title collided on the PK and the membership upsert's `ON CONFLICT DO NOTHING` silently dropped the second owner. The `uq(userId, tmdbId, mediaType)` index is itself the proof the design intends multi-user same-title. Fixed to a **composite primary key `(user_id, id)`** (`id` stays `"type:tmdbId"` so it still equals the catalog metadata `candidateId` enrich keys on; it is unique only *within* a user). Migration `0004` regenerated.
- **Collections null-name keyset.** The `ORDER BY` and cursor predicate compared the raw nullable `collection_name`, but the encoded cursor uses `collection_name ?? collection_id` — so null-name franchises were silently dropped across a page boundary (the phase-2 timeline COALESCE lesson, not carried over). Both now compare `COALESCE(collection_name, collection_id)`.
- **Collections preview was not filter-aware.** The group `count` honored the active filters but the preview poster fan did not, so it could surface titles excluded from the count. The preview correlated subquery now applies the same filter predicates → preview ⊆ the counted set.
- **`selectRowsByIds` tenancy scope.** Preview hydration read rows by bare `id IN (…)`; the composite id is global, so it now also scopes to `user_id` + `owned = true` (every library read is owned-set scoped).
- **Quality rank direction.** "tierRank DESC fidelity" is realized as an ASCENDING sort on the `QUALITY_TIERS` ordinal (0 = highest), so the keyset predicate is correctly `rank > cursor` (a larger ordinal = lower fidelity = later). `QUALITY_RANK_UNRANKED === QUALITY_TIERS.length` keeps the SQL `CASE … ELSE` arm and the JS `rankQualityTier` in lockstep.
- **Section surfacing.** Server/quality lenses repeat a title per section; each expanded row carries the section via an additive optional `CompactMediaItem.section?: { id, label }` (set only by these two lenses) so the FE inserts headers on group-key change and keys list rows by `id + section`.

### Phase 4 — done (✓ shippable)

Shipped: the library FE rewired from mock to real data, look preserved. The four item lenses go through the existing shared `useMediaRows` infinite-query hook against `GET /api/media/sources/library-<lens>` (no new client fetch path — same as home/watchlist); collections via `api.library.collections`, facets via `api.library.facets` (non-blocking `useQuery`). `lib/fetchers.ts` (Hono `api.*` + `LibraryApiError`), per-lens+filter query keys, and a pure `section-groups` helper that inserts headers on group-key change over the flat sorted stream (az letter / timeline decade / server-quality `item.section`), keying server/quality rows by `id + section`. Infinite scroll via the shared `VirtualGrid` (`onEndReached` guarded by `shouldFetchNext`). Quality chips render from `CompactMediaItem.tags`; collections render the `preview: CompactMediaItem[]` poster fan with the server `count` badge. A-Z letter rail and timeline decade rail both driven by `/facets` (`letters` / `decades`, present-only). Filters round-trip URL → query params. `LIBRARY_LENSES`/`WATCHED_STATES`/`QUALITY_TIERS` now imported from `@nama/shared/library`; the mock fixtures, `fetchLibrary` stub, and client-side grouping/filtering deleted. Added `.fallowrc.json` allows for `client-feat-library` → `client-shared-virtualized` + `client-shared-media` (the mandated reuse). Changeset: `@nama/client` minor.

Deviations / fixes (adversarial verify + tests caught a functional filter bug + an i18n regression):
- **Servers filter alignment.** The `servers` facet keys on the human `label`, but the lens + collections filter predicates matched on the connection `id` — so any server filter matched nothing. Fixed: the filter predicates now match on `value ->> 'label'` (facet key == popover value == filter value); the server lens still *sections* by `id`. Regression-tested.
- **Timeline `unknown` localized.** `section-groups` now emits a stable i18n-free key; the display label resolves at the render boundary via `timelineSectionLabel` → `m.library_timeline_unknown()` (was rendering the raw English literal in all locales).
- **`decades` facet now consumed** — wired into a timeline decade jump-rail mirroring the A-Z letter rail (was computed by `/facets` but unused).
- **Multi-value filter axes resolved (was a carried limitation).** Multi-value filter axes (`?genres=A&genres=B`) on the *item lenses* previously collapsed to the first value because the unified `/media/sources/:id` resolver read `c.req.query()` (single-value); collections + facets already honored multi-value via their own routes. The server-side followup landed (ledger entry 15): the resolver now reads the multi-value-flattened map via `c.req.valid("query")` and the client forwards the axes as repeated params, so the item lenses honor multi-value uniformly with the collections/facets routes.

### Cross-phase bug ledger (found by adversarial verify / Rule-9 tests, all fixed + regression-guarded)

1. Membership sync wiped the whole owned library on a transient all-providers outage (empty `feedKeys` swept every row) → sweep gated on a complete non-empty feed.
2. `writeMetadata` conflict-UPDATE dropped franchise columns → added to the SET clause.
3. Lens keyset encoded the dropped `limit+1` overflow row → encode the last *returned* row.
4. Timeline `ORDER BY` disagreed with the `COALESCE` cursor predicate on NULL years → aligned.
5. Facet `count(*)` over `json_each` double-counted duplicate array values → `count(DISTINCT id)` (table-qualified to avoid the `json_each` `id` ambiguity).
6. **Multi-tenancy:** single global `id` PK forbade two users owning the same title → composite `(user_id, id)` PK.
7. Collections keyset dropped NULL-name franchises across a page boundary → `COALESCE(collection_name, collection_id)` in ORDER BY + predicate.
8. Collections preview fan wasn't filter-aware while the count was → filters threaded into the preview subquery.
9. `selectRowsByIds` preview hydration was unscoped (cross-tenant read) → scoped to `user_id` + `owned`.
10. Server/quality lenses selected a drizzle column-object over a raw `json_each` FROM (libsql runtime error on every request) → table-qualified `EXPANDED_ROW_COLUMNS`.
11. Servers filter matched `id` while the facet/popover used `label` → matched on `label`.
12. **#597 — hydrate availability fan-out was unbounded.** The §Sync+hydrate N-call fan-out fired `Promise.all` over the entire stale set, so a large library could launch unbounded concurrent plugin requests (provider rate-limit bans / socket exhaustion). Now fanned out in chunks of `HYDRATE_CONCURRENCY` (25, matching the catalog metadata-refresh `BATCH_SIZE`) so ≤2×25 probes are in-flight at once, and each chunk is persisted (`writeHydration`) as it resolves so a row that blows its scheduled wall-clock timeout keeps the chunks already finished and the next run resumes from where it stopped.
13. **#597 — tombstone sweep overflowed SQLite's variable limit.** The full-sweep `tombstoneMissing` bound one parameter per kept key in a single `notInArray`, so a library with >999 kept keys blew SQLite's 999-bound-variable limit. Now: empty-keep → full sweep; ≤900 keep → single `notInArray` (≤902 bound params); >900 keep → JS set-diff then chunked `inArray` updates (read-then-update, safe only under the single-writer sync model, documented inline).
14. **#597 — `staleOrNew` chunk order was incidental.** The hydrate target query had no `ORDER BY`, so the chunked fan-out relied on SQLite's implicit PK order for its boundaries and `writeHydration`'s "id order" claim. Added `.orderBy(libraryItems.id)` so chunk boundaries are genuinely deterministic and the partial-failure prefix is stable run-to-run.
15. **#613 — multi-value lens filter axes collapsed to the first value.** The unified `/media/sources/:id` resolver read `c.req.query()` (single-value), so a repeated lens filter param (`?genres=A&genres=B`) lost every value but the first, while collections/facets honored multi-value via their own routes. Now the resolver reads the multi-value-flattened map via `c.req.valid("query")` (single occurrence stays a string, repeated becomes a `string[]`) and the client `toQuery` forwards a non-empty `string[]` axis as repeated params. Per-source schemas stay authoritative — single-value home/watchlist schemas see plain strings; the lens schema's array axes accept the arrays. This closed the Phase 2/4 carried limitation above.

**Test totals:** server `apps/server` 648 + full monorepo 2674 passing; client library 44. `vp check` clean (1553 files); `fallow dead-code` → 0 boundary violations, baseline unchanged.

# Catalog Service

**Status:** Draft (rev 5)
**Date:** 2026-04-27
**Author:** Omid Astaraki
**Deps:** `2026-04-20-job-service-design.md`, `2026-04-20-preference-engine-design.md`, `2026-04-22-home-feed-design.md`, `2026-04-26-plugin-fanart-design.md`, `2026-04-27-home-feed-perf-design.md`
**Amends §V:** V37–V45

## Summary

Cache-heavy serve path → DB-precomputed serve path. Today: most installs ⊥ Redis → in-mem `mv:` LRU evaporate on restart → home feed cold every restart, home rows pay full plugin-dispatch cost (TMDB rate-limited, latency variance high).

Migrate persistent media data to SQLite. Cache shrinks → live plugin calls only. New `CatalogService` owns canonical metadata, discover snapshots, recommendation lists, user history/ratings mirrors. Jobs precompute nightly. Read path = sub-ms DB hit + live fallback on miss. Outcome: home rows warm across restarts, recommendations free of TMDB pressure, single-instance SQLite installs default-fast.

## Goals

- Recs precomputed nightly per user → serve = 1 DB read.
- Canonical metadata (title/year/runtime/genres/poster/backdrop/clearLogo/thumb/features) persisted → 0 plugin calls on warm read.
- Discover feeds (newReleases/trending/upcoming/popular) day-snapshotted → stable cache key, drift-free pagination.
- User history + ratings mirrored append-only → preference rebuild reads DB only.
- `mv:` cache retained for live plugin calls (watchlist, idResolve, fan-out writes).
- DB lean → only fields app reads; prune unused; fall back to plugin on miss.
- Maintainability → boundary clear; jobs reuse existing job-service surface; schema portable Postgres-later.

## Non-goals

- ⊥ Redis required. Optional latency layer only.
- ⊥ multi-instance. Single-host SQLite v1.
- ⊥ watchlist mirror. Live dispatch only (volatile).
- ⊥ ID denormalization onto `canonical_metadata`. `id_map` separate.
- ⊥ full TMDB payload mirror. Minimal field set.
- ⊥ Postgres migration v1. Drizzle abstracts; address when scale demands.
- ⊥ locale-keyed discover snapshots v1.
- ⊥ webhook ingestion. Scheduled poll only.
- ⊥ plugin-contract change. Mirror sync uses existing `getHistory`/`getRatings` aggregate fetches; incremental = host-side diff.

## Architecture

```
[home/rows] ──► CatalogService ──► SQLite                          (warm path, sub-ms)
       │
       └────► MediaService    ──► mv: cache ──► plugin              (live path)

[jobs] ──► CatalogService ──► SQLite                                (writes)
       └─► MediaService  ──► plugin                                 (read inputs to fill catalog)

[PE.getItemFeatures(userId, tmdbId, type)] ──► CatalogPreferenceProvider
                              ├─ catalog.getMetadata(tmdbId, type) → features?
                              └─ miss → MediaServicePreferenceProvider (existing)
                                         → catalog.writeMetadata(row)   (fire-and-forget)
                                         → return features
```

`CatalogService` = peer of `MediaService`. Lives `apps/server/src/catalog/`. Injected into `RowFetchContext`.

Boundary rule:
- "we own a copy" → CatalogService.
- "we proxy live" → MediaService.
- Jobs = sole catalog writer. Exception: bounded cold-fill on PE miss; write-back fire-and-forget so a failed write ⊥ block read; metric tracked.

## Data model

5 new tables. Drizzle. SQLite-first, Postgres-portable (text JSON columns; `jsonb` swap later w/o code change).

```
canonical_metadata
├── tmdb_id              text NOT NULL
├── media_type           text NOT NULL          ("movie" | "tv")
├── title                text NOT NULL
├── year                 integer
├── runtime_minutes      integer
├── poster_url           text                   -- D1 single canonical
├── backdrop_url         text
├── clear_logo_url       text
├── thumb_url            text
├── overview             text
├── original_language    text
├── genres               text                   -- JSON ["Thriller", "Crime"]
├── features             text                   -- JSON { keywords, people, decades, runtimeBucket, language }
├── last_refreshed_at    integer NOT NULL
├── last_accessed_at     integer NOT NULL
├── created_at           integer NOT NULL
├── PRIMARY KEY (tmdb_id, media_type)
├── INDEX(last_refreshed_at)                    -- nightly stale sweep
└── INDEX(last_accessed_at)                     -- prune sweep

discover_snapshots
├── feed_kind            text NOT NULL          ("newReleases" | "trending" | "upcoming" | "popular")
├── sort                 text NOT NULL          ("popularity_desc" | "release_date_asc" | …)
├── day                  integer NOT NULL       -- floor(now / DAY_MS) * DAY_MS
├── items                text NOT NULL          -- JSON [{ tmdb_id, media_type }]
├── generated_at         integer NOT NULL
├── PRIMARY KEY (feed_kind, sort, day)
└── INDEX(day)                                  -- prune

recommendation_lists
├── user_id              text NOT NULL          FK → user.id
├── list_kind            text NOT NULL          ('default' v1)
├── items                text NOT NULL          -- JSON [{ tmdb_id, media_type, match_reason, score }]
├── profile_version      integer NOT NULL       -- bumps inside PE.rebuildProfile storage write;
│                                                -- applyIncrementalUpdate ⊥ bumps (rec list intentionally
│                                                -- stale until next nightly per V43)
├── generated_at         integer NOT NULL
└── PRIMARY KEY (user_id, list_kind)

user_history_mirror
├── user_id              text PRIMARY KEY       FK → user.id
├── events               text NOT NULL          -- JSON [{ tmdb_id, media_type, watched_at, source_connection_id, episode_key?, progress? }]
├── plugin_cursors       text NOT NULL          -- JSON { [connection_id]: last_synced_ts }   -- history-only; per-table
└── last_synced_at       integer NOT NULL

user_ratings_mirror
├── user_id              text PRIMARY KEY       FK → user.id
├── events               text NOT NULL          -- JSON [{ tmdb_id, media_type, rating, rated_at, source_connection_id }]
├── plugin_cursors       text NOT NULL          -- JSON { [connection_id]: last_synced_ts }   -- ratings-only; per-table
└── last_synced_at       integer NOT NULL
```

`id_map` (existing schema, `apps/server/src/db/schema/id-map.ts`) ⊥ touched. Cross-provider IDs joined on `(tmdb_id, media_type)` in `Catalog.getMetadataWithIds`. ⊥ duplicate ID writers (V41).

`preference_profiles` (existing) gains a `version` column (monotonic int, bumps on rebuild) → references from `recommendation_lists.profile_version` (V43). One-line migration.

Sizes (rough):
- metadata row ≈ 3KB display + 5KB features = 8KB
- 20K items × 8KB ≈ 160MB
- rec list 60×~150B ≈ 10KB/user
- mirror blob: light ≈ 10KB, heavy ≈ 500KB
- 100 users + 20K items ≈ 200MB DB

Eviction:
- `canonical_metadata` → drop if `last_accessed_at < now - 90d` AND ⊥ ref by any `recommendation_lists.items` AND ⊥ ref by `discover_snapshots` within 7d retention.
- Implementation: prune builds an in-memory `Set<id_key>` of referenced ids in one pass over `recommendation_lists` + last-7d `discover_snapshots`, then table-scans `canonical_metadata` filtering against the set + access threshold. Single pass; memory bound = referenced-id count (≤ users × 60 + 4 × 60 ≈ 6K-key set for 100-user install). Avoids JSON-substring per row.
- `discover_snapshots` → drop `day < now - 7d`.
- `recommendation_lists` → never drop; replaced atomic on rebuild.
- `*_mirror` → never drop (append-only contract per V39).

## CatalogService surface

```
CatalogService {
  // ── reads (serve path) ──
  getMetadata(tmdbId, type)                            → CanonicalMetadata | null
  getMetadataBatch(items[])                            → Record<id, CanonicalMetadata>
  getMetadataWithIds(tmdbId, type)                     → CanonicalMetadata + IdMap | null
  getDiscoverFeed(kind, sort, day)                     → [{ tmdbId, type }] | null
  getRecommendations(userId, kind = 'default')         → { items, profileVersion, generatedAt } | null
  getUserHistory(userId)                               → HistoryEvent[]
  getUserRatings(userId)                               → RatingEvent[]
  getHistoryCursors(userId)                            → { [connectionId]: last_synced_ts }
  getRatingsCursors(userId)                            → { [connectionId]: last_synced_ts }

  // ── writes (jobs only; serve ⊥ except cold-fill) ──
  writeMetadata(rows[])
  writeDiscoverSnapshot(kind, sort, day, items[])
  writeRecommendationList(userId, kind, items[], profileVersion)
  appendUserHistory(userId, events[], connId: string, cursorTs: integer-ms)
                                                       -- per-user mutex; BEGIN IMMEDIATE;
                                                       -- merges cursor slot via max(prior, cursorTs) inside tx
  appendUserRatings(userId, events[], connId: string, cursorTs: integer-ms)
                                                       -- same shape

  // ── access bookkeeping ──
  recordAccess(items[])                                -- in-process Map<id_key, last_bump_ts>; flushes ≥ hourly per row

  // ── job ops ──
  listStaleMetadata(staleAfterMs, limit)               → MetadataKey[]
  pruneUnusedMetadata(unusedAfterMs)                   → { deleted }
  pruneOldDiscoverSnapshots(olderThanDays)             → { deleted }
}
```

`RowFetchContext` extended:

```
RowFetchContext {
  userId
  mediaService                 // unchanged: live plugin dispatch
  catalogService               // NEW
  preferenceEngine             // unchanged interface; gains catalog provider internally
  dataloader
  logger
  deadlineMs?
}
```

PE provider keeps existing per-item interface (apps/server/src/preferences/provider.ts):

```
interface PreferenceDataProvider {
  getItemFeatures(userId, tmdbId, type)  → CandidateFeatures | null
  getHistory(userId)                      → HistorySignal[]
  getAllRatings(userId)                   → RatingSignal[]
  getWatchlist(userId)                    → WatchlistSignal[]
  getComments(userId)                     → CommentSignal[]
}
```

New `CatalogPreferenceProvider` wraps existing `MediaServicePreferenceProvider`:

```
CatalogPreferenceProvider impls PreferenceDataProvider {
  ctor(catalog: CatalogService, fallback: MediaServicePreferenceProvider)

  getItemFeatures(userId, tmdbId, type) →
    row = catalog.getMetadata(tmdbId, type)                       -- sub-ms PK lookup
    if row?.features: return parseFeatures(row.features)
    -- cold-fill: per-key plugin call via existing dispatchPrimary
    feat = fallback.getItemFeatures(userId, tmdbId, type)
    if feat:
      void catalog.writeMetadata([toCanonicalRow(tmdbId, type, feat)]).catch(log)
                                                                   -- detached promise; ⊥ block read;
                                                                   -- explicit `void … .catch(log)` form
                                                                   -- avoids floating-promise lint.
                                                                   -- writeMetadata uses INSERT OR REPLACE keyed on
                                                                   -- (tmdb_id, media_type) so concurrent dup writes
                                                                   -- on the same miss = idempotent last-write-wins.
                                                                   -- Job-path callers DO await; only the cold-fill
                                                                   -- detaches.
    return feat

  getHistory(userId) →                                              -- post-PR-5; pre-PR-5 = fallback.getHistory
    rows = catalog.getUserHistory(userId)
    return rows.map(r => ({                                         -- adapt mirror row → HistorySignal:
      tmdbId:    r.tmdb_id,                                         -- snake → camel
      mediaType: r.media_type,
      watchedAt: r.watched_at,
      progress:  r.progress ?? null                                 -- progress lives on mirror event;
    }))                                                             -- added to user_history_mirror.events
                                                                    -- shape (see Data model)
  getAllRatings(userId)→                                             -- post-PR-5; pre-PR-5 = fallback.getAllRatings
    rows = catalog.getUserRatings(userId)
    return rows.map(r => ({
      tmdbId:    r.tmdb_id,
      mediaType: r.media_type,
      rating:    r.rating,
      ratedAt:   r.rated_at,
    }))
  getWatchlist(userId)→  fallback.getWatchlist(userId)             -- always live (V40)
  getComments(userId)→   fallback.getComments(userId)              -- not mirrored
}
```

Per-item read concurrency:
- `rebuild.ts:192` already uses `CONCURRENCY=10` loop. Catalog hits sub-ms; OK.
- `enrichCandidates` (engine.ts:129) uses unbounded `Promise.all(candidates.map(...))`. For 180-candidate `rankCandidates`, every catalog hit = sub-ms, ⊥ issue. Cold-fill misses fan out → could storm TMDB. PR 2 adds same `CONCURRENCY=10` cap to cold-fill plugin dispatch in the provider (the catalog read itself stays fan-out — fast either way).
- `incremental.ts:64` — single item per call inside coalesced loop; ⊥ concern.

Engine deadline propagation: `PreferenceEngine.rankCandidates(userId, candidates, opts)` already accepts opts; add `opts.deadlineMs?`. Engine threads to provider call as elapsed-time check before each cold-fill plugin dispatch (already-cached items skip the check). Out-of-budget remaining items return `null` features → engine handles thin features as today (lowered confidence).

Wiring sites (3):
- `apps/server/src/preferences/engine.ts:149` — `enrichCandidates` from `rankCandidates` path; threads `opts.deadlineMs` through.
- `apps/server/src/preferences/rebuild.ts:200` — full rebuild from nightly job; threads `opts.deadlineMs` through (rebuild handler passes its own deadline derived from `runTimeoutSec`).
- `apps/server/src/preferences/incremental.ts:64` — coalesced `host.preference.incremental_update`; **bypasses deadline** (already short, debounced, ⊥ user-facing). Pass `undefined` explicitly so any miss cold-fills fully.

## MediaService additions

`MediaService` is per-user (`new MediaService(userId)` constructed per request via context builder). Catalog jobs that operate on user data instantiate per row: `new MediaService(user.userId)` inside the `scheduled_per_row` body. For the `metadata_refresh` job (no user context), `metadata@v1` is a global-scope capability — bypass `MediaService` and call the dispatcher directly via the existing `dispatchPrimary({ capability: "metadata", … })` form, OR construct a system MediaService w/ a sentinel userId. Doc keeps the latter form for surface uniformity.

Three new methods. All wrap existing dispatcher — ⊥ new plugin contract.

```
MediaService {
  // existing: discoverFeed, getRecommendationsFeed, getSimilarFeed, …

  // NEW (PR 2). Wraps dispatchPrimary({ capability: "metadata", method: "getDetails", input: { id: tmdbId, type } }).
  // metadata@v1 is global-scope so per-user binding doesn't matter; nightly job uses
  // a system MediaService instance constructed once at startup.
  getMetadata(tmdbId, type) → MetadataResult

  // NEW (PR 5). Wraps dispatchAggregate; same shape as PE provider's getHistory/getAllRatings today.
  // Plugin contract unchanged: full-list fetch. Incremental = host diff against mirror.
  // Per-user instance: `new MediaService(userId)` per row in `user_mirror_sync`.
  getAllHistory(connId?)  → HistoryItem[]                 -- optional connId narrows to one connection
  getAllRatings(connId?)  → RatingItem[]
}
```

`getAllHistory` / `getAllRatings` return whole list per call. Plugin-side `since` cursor ⊥ supported across plugins (Trakt has it, Plex/Jellyfin don't). Sync job does the diff host-side: read full list → filter against mirror's `(tmdbId, source_connection_id, watched_at)` set → append the new ones. Cursor `last_synced_ts` records max `watched_at` seen, advances on success per capability — ⊥ shared cursor between history + ratings (independent failure modes).

## Refresh + jobs

5 new jobs. Namespace `host.catalog.*`. All registered via existing job-service. All `adminTriggerable: true`. All declare `runTimeoutSec` to bound contention.

```
host.catalog.recommendation_build         (scheduled_per_row, 02:00 daily; runTimeoutSec = 90 * 60)
  rows = users w/ activity in last N days OR last_rebuilt_at > 7d OR ≥20 feedback events
  per user:
    PE.rebuildProfile(movie | tv | combined)                       -- bumps profile.version
    candidates = mediaService.getRecommendationsFeed(limit=180)
    ranked     = PE.rankCandidates(userId, candidates, { deadlineMs: now + 60s })
    items      = top 60 → { tmdbId, type, matchReason: PE.explainRanked(userId, entry), score }
    catalog.writeRecommendationList(userId, 'default', items, profile.version)

host.catalog.metadata_refresh             (scheduled, 04:00 daily; runTimeoutSec = 60 * 60)
  stale = catalog.listStaleMetadata(30d, limit=500)
  ∀ slice ∈ chunk(stale, 25):                                     -- BATCH=25 bound TMDB rate-limit
    results = Promise.allSettled(systemMediaService.getMetadata(key.tmdbId, key.type) ∀ key ∈ slice)
    catalog.writeMetadata(toCanonicalRows(ok))
    abort on ctx.abortSignal

host.catalog.discover_snapshot            (scheduled, 06:00 daily; runTimeoutSec = 30 * 60)
  day = floor(now / DAY_MS) * DAY_MS
  ∀ (kind, sort) ∈ [(newReleases, popularity_desc),
                    (trending,    popularity_desc),
                    (upcoming,    release_date_asc),
                    (popular,     popularity_desc)]:
    result = mediaService.discoverFeed({ kind, sort, limit=60 })
    catalog.writeMetadata(toCanonicalRows(result.items))           -- side-effect warm
    catalog.writeDiscoverSnapshot(kind, sort, day, toIdRefs(result.items))

host.catalog.user_mirror_sync             (scheduled_per_row, every 6h; runTimeoutSec = 30 * 60)
  rows = active connections w/ watchHistory@v1 | ratings@v1
  per (userId, connId):
    ms = new MediaService(userId)                                  -- per-user instance for plugin dispatch
    -- HISTORY (independent table, independent cursor blob)
    try:
      full     = ms.getAllHistory(connId)
      existing = catalog.getUserHistory(userId)                    -- all events; filter to connId next
      seen     = new Set(existing.filter(e => e.source_connection_id == connId)
                                 .map(e => key(e)))
                                                                   -- key: (tmdbId, mediaType, watched_at, episode_key ?? '')
      newHist  = full.filter(e => !seen.has(key(e)))
      if newHist.length > 0:
        catalog.appendUserHistory(userId, newHist, connId, maxTs(newHist))
                                                                   -- atomic merge inside tx: read prior cursor blob,
                                                                   -- write events ++, update only this connId's
                                                                   -- slot to max(prior_slot, cursorTs)
    catch: log + ⊥ advance history cursor
    -- RATINGS (independent table, independent cursor blob)
    try:
      full     = ms.getAllRatings(connId)
      existing = catalog.getUserRatings(userId)
      seen     = new Set(existing.filter(e => e.source_connection_id == connId)
                                 .map(e => key(e)))                -- key: (tmdbId, mediaType, rated_at)
      newRate  = full.filter(e => !seen.has(key(e)))
      if newRate.length > 0:
        catalog.appendUserRatings(userId, newRate, connId, maxTs(newRate))
    catch: log + ⊥ advance ratings cursor

host.catalog.prune                        (scheduled, 07:00 daily; runTimeoutSec = 30 * 60)
  -- Skip if any rec_build is currently running (covers nightly + admin-triggered + feature.preference.rebuild).
  -- Job-service exposes the running-set; check via jobService.isRunning(prefix='host.catalog.recommendation_build')
  -- AND jobService.isRunning('feature.preference.rebuild') → either present, mark this run skipped + retry next slot.
  if jobs.anyRunning(['host.catalog.recommendation_build',
                      'feature.preference.rebuild']):                  -- PR 6 adds anyRunning helper
    return { skipped: 'rec_build_in_progress' }
  refSet = build_ref_set(catalog.allRecListItems(), catalog.discoverSnapshotsLast(7d))
  catalog.pruneUnusedMetadata(90d, refSet)
  catalog.pruneOldDiscoverSnapshots(7)
```

Schedule rationale + contention:
- Slots: 02 / 04 / 06 / 07 daily. 2h gap between rec_build (90m bound) and metadata_refresh (60m bound). discover_snapshot (30m bound) at 06 → ≥ 1h after metadata_refresh deadline. prune at 07 → ≥ 30m after discover_snapshot deadline.
- ⊥ overlap by construction. Job-service skip-if-running covers self-overlap.
- Cross-job concurrent reads safe: SQLite WAL = readers never block writers. Cross-job concurrent writes serialized by SQLite single-writer lock; jobs work on distinct rows so contention is at storage layer not logical.
- `recommendation_build` cold-fill writes are append-or-replace on `canonical_metadata` PK; concurrent with `metadata_refresh` they win-on-write order, no corruption.

Existing jobs preserved:
- `host.preference.incremental_update` (coalesced) → updates profile incrementally on `ent_feedback`. ⊥ regenerate rec list (next nightly picks up).
- `feature.preference.rebuild` (triggerable, user-scoped) → extended to also write rec list. Same body as `recommendation_build` scoped to one user; reuses `scopeKey: userId` to serialize against nightly per-user run.

Refresh policy summary:

| data                  | lazy-fill                                   | scheduled refresh                    | eviction                              |
| --------------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------- |
| canonical_metadata    | PE miss + home-row first sight              | nightly stale-sweep (>30d, batch 25) | nightly unused 90d AND unreferenced   |
| metadata.features     | piggyback on metadata fill                  | piggyback                            | piggyback                             |
| artwork URLs (single) | piggyback on metadata fill (fanart > tmdb)  | piggyback                            | piggyback                             |
| discover_snapshots    | ⊥ lazy; null → live `discoverFeed`          | nightly per (kind, sort, today)      | nightly drop `day < now - 7d`         |
| recommendation_lists  | ⊥ lazy; null → live rank-on-request         | nightly per active user              | replaced; never dropped               |
| history/ratings       | ⊥ lazy                                      | every 6h per connection              | never (append-only)                   |

## Concurrency

Append-only mirror writes use per-user mutex (in-process Map<userId, Promise>) + SQLite `BEGIN IMMEDIATE` transaction per write. Two paths can target one user's blob:
- Nightly `user_mirror_sync` for that user's connection
- User-triggered `feature.preference.rebuild` (reads mirrors but ⊥ writes mirror tables; does write `recommendation_lists` + cold-fill `canonical_metadata` — those have own concurrency story per V37/§Concurrency above)
- Future webhook ingestion (out of scope v1)

`appendUserHistory` body (atomic):

```
withUserMutex(userId, async () =>
  tx BEGIN IMMEDIATE:
    row     = SELECT user_history_mirror WHERE user_id = userId
    merged  = dedupe(row.events ++ events,
                     key = (tmdb_id, media_type, source_connection_id, watched_at, episode_key ?? ''))
                                                                  -- nullable episode_key: treat absent as
                                                                  -- stable bucket; movie events ⊥ collide w/
                                                                  -- episode events of same parent
    prev    = row.plugin_cursors[connId] ?? 0
    cursors = { ...row.plugin_cursors, [connId]: max(prev, cursorTs) }   -- monotonic; out-of-order plugin events ⊥ regress
    UPDATE user_history_mirror SET events         = json(merged),
                                   plugin_cursors = json(cursors),
                                   last_synced_at = now
                              WHERE user_id = userId
  COMMIT
)
```

History + ratings live in **separate tables**, each w/ its own `plugin_cursors` blob — ⊥ shared cursor between capabilities. Cursor merge happens inside the write tx (against latest prior cursor row), ⊥ at caller — eliminates clobber when a prior write to the same blob happened between caller's read and the append. Failure of ratings sync ⊥ touch history table (separate try/catch in job body).

Per-user mutex = process-local `Map<userId, Promise>`. **Multi-instance correctness requires postgres advisory locks** — see Open Questions. Single-instance v1 covered.

`recordAccess` storage: in-process `Map<"{type}:{tmdbId}", number>` on `CatalogService` instance. Value = last-DB-bump timestamp. On `recordAccess([items])` only items absent from map OR last-bump ≥ 1h ago hit DB (single batched UPDATE).

Map retention: drop entries when last-bump ≥ **2h** ago (well past the 1h throttle window). Avoids the rollover hazard — an evicted key's next read would otherwise re-bump regardless of recent prior bump. Memory bound: 50K hot ids × ~64B ≈ 3MB. Stable.

Flush mechanism: per-key on next access only — ⊥ separate timer. Items with last-bump ≥ 1h get UPDATE'd inline next time they're read; items below threshold skip. Map cleanup runs lazily on insert (drop-2h-stale during set).

Lost on restart = acceptable: nightly prune uses `last_accessed_at` only to prefer truly-cold items; freshly-restarted process bumps on first read (one extra UPDATE per warm key, amortized away within an hour).

## Cache role

```
before:
  serve ──► MediaService ──► dispatch-cache (mv:) ──► plugin

after:
  serve
   ├─► CatalogService ──► SQLite                            (warm path, sub-ms)
   └─► MediaService  ──► dispatch-cache (mv:) ──► plugin    (live path only)
```

Decisions:
- `mv:` cache stays. Scope shrinks → live MediaService calls only (watchlist, idResolve, fan-out writes).
- ⊥ memoization layer above Catalog. SQLite indexed PK = sub-ms; in-mem LRU buys nothing + adds invalidation surface.
- `dispatch-cache` `NEGATIVE_TTL_MS` + `ttlOverrideMs` (per `2026-04-27-home-feed-perf-design.md`) retained — useful for plugin failures on live path.
- Redis stays optional. Persistence in DB → Redis = pure latency optimization, ⊥ correctness requirement.
- CF Workers: catalog Turso-friendly; identical Drizzle schema. ⊥ change to `worker.ts` exclusions.

## Row fetcher hydration

Once catalog populated, row fetchers hydrate cards from `canonical_metadata` instead of plugin `RawMediaItem`. Pipeline:

```
recommendedForYou.fetch(ctx, opts):
  list = catalog.getRecommendations(userId, 'default')
  if list == null:
    -- live fallback: existing rank-on-request path
    return existingRankPath(ctx, opts)
  -- Cursor v2 = { p: page, pv: profileVersion }. Wire-format break OK per V36 (frontend opaque).
  -- Mismatch (rebuild happened mid-paginate) → reset to p=0; ⊥ exclusion-list (precomputed list stable per pv).
  { p, pv } = readCursor(opts.cursor)
  if pv != null && pv != list.profileVersion: p = 0
  byId    = new Map(list.items.map(i => [`${i.media_type}:${i.tmdb_id}`, i]))
  ids     = paginate(list.items, p, opts.limit).map(i => `${i.media_type}:${i.tmdb_id}`)
  rows    = catalog.getMetadataBatch(ids)
  if rows missing any: fillMissing(rows, ids \ keys(rows), ctx.deadlineMs)
                                                          -- per-id cold-fill bounded by deadline;
                                                          -- deadline-exceeded items kept absent →
                                                          -- emitted as missing slots; page can return < opts.limit
  rawItems = ids.map(id => rows[id]
                            ? toCompact(rows[id], { matchReason: byId.get(id).matchReason })
                            : null)
  partial  = rawItems.some(x => x == null)
  emitted  = rawItems.filter(present)
  cursor   = (p+1) * opts.limit >= list.items.length
               ? null
               : encode({ p: p+1, pv: list.profileVersion })
  return { items: emitted, cursor, partial }

newReleases.fetch(ctx, opts):
  day = floor(now / DAY_MS) * DAY_MS
  refs = catalog.getDiscoverFeed('newReleases', 'popularity_desc', day)
  if refs == null:
    -- live fallback: existing day-rounded discoverFeed path (per perf doc)
    return existingDiscoverPath(ctx, opts)
  page  = readPage(opts.cursor)
  slice = refs.slice(page * opts.limit, (page + 1) * opts.limit)
  rows  = catalog.getMetadataBatch(slice)
  items = slice.map(ref => toCompact(rows[ref.id], {}))
  -- snapshot capped at 60; once page * limit >= 60, cursor = null (⊥ live tail)
  cursor = (page+1) * opts.limit >= refs.length ? null : encode(...)
  return { items, cursor, partial: items.length < slice.length }
```

`partial: true` propagation rule: any hydrate miss within emitted page = `partial: true`. Same flag the perf-doc fix preserves on live path.

Page can return **fewer items than `opts.limit`** when partial (deadline-exceeded items dropped). Client treats `partial: true` as "more may stream — refetch later" rather than "end of list" — current frontend already handles this per `2026-04-23-home-feed-frontend-design.md`.

Snapshot pagination capped at stored 60 (matches existing `MAX_ITEMS = 60` in row fetchers). ⊥ fall-through to live `discoverFeed` mid-page — would conflate two orderings + hide drift bugs. If user paginates past 60, row ends. Cursor v2 for `recommendedForYou` = `{ p, pv }`; for discover rows = existing `{ p }` (no profile version).

## Migration / rollout

Sequential PRs. Each ships independent; rollback = revert one PR. Each adds one new job + one new read site; old code continues if job disabled via `job_config`.

| PR | adds                                                                                                                                                                  |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | schema migration + CatalogService scaffold (empty methods, drizzle tables, ⊥ jobs); `preference_profiles.version` column (`integer NOT NULL DEFAULT 0`); `rebuild.ts` reads current version, increments, calls `profileStorage.write({ ..., version })`; `applyIncrementalUpdate` ⊥ touches it |
| 2  | `MediaService.getMetadata`; canonical_metadata + features blob writes; `CatalogPreferenceProvider` w/ cold-fill; PE `opts.deadlineMs` wiring; `metadata_refresh` job   |
| 3  | discover_snapshots + `discover_snapshot` job; `newReleases`/`trendingNow`/`upcomingForYou` row hydration (live fallback)                                              |
| 4  | recommendation_lists + `recommendation_build` job; `recommendedForYou` row hydration (live fallback); `feature.preference.rebuild` extended to write rec list         |
| 5  | `MediaService.getAllHistory` + `getAllRatings`; user_history_mirror + user_ratings_mirror + `user_mirror_sync` job; `CatalogPreferenceProvider` switches to mirror reads (provider swap = server bootstrap DI; `rebuild.ts` + `incremental.ts` consume `deps.provider` polymorphically) |
| 6  | `prune` job + `recordAccess` bookkeeping wired into row reads; **JobService surface additions**: re-export `isRunning(jobId, scopeKey?)` from `apps/server/src/jobs/index.ts` + add `anyRunning(jobIds[]) → boolean` helper (trivial `.some(isRunning)`); `prune` job consumes it |
| 7  | cleanup: drop redundant `mv:` TTLs catalog now owns (e.g. discover snapshot caching path)                                                                              |

Rollout invariants:
- ∀ catalog read = "DB hit OR live fallback to existing code." Enabling catalog ⊥ break; only short-circuit slow path.
- ⊥ feature flag. Each PR = additive.
- Schema migrations follow existing Drizzle pattern.

Changesets per PR (per CLAUDE.md):
- `@ent-mcp/server` → `minor` (PR 2–5: new persistence model affects user-visible warm-cache behavior). PR 1 = empty frontmatter (schema migration + scaffold = internal-only). PR 6 = `patch` (prune + recordAccess = visible perf). PR 7 = empty frontmatter (cleanup, no behavior change).
- `@ent-mcp/shared` → ⊥ touched unless new shared types added.
- `@ent-mcp/client` → ⊥ touched.

## Testing

- **CatalogService unit** (`apps/server/src/catalog/__tests__/`): per-table CRUD; append-only dedupe semantics; SQLite in-memory fixture.
- **Concurrency** (`apps/server/src/catalog/__tests__/mirror-concurrency.test.ts`): two concurrent `appendUserHistory` for same user → both events present + cursor monotonic; mutex serializes; SQLite tx isolates.
- **Cursor independence** (`mirror-cursors.test.ts`): history sync fails after ratings sync succeeds → ratings cursor advances, history cursor unchanged; next run re-pulls history without duplicating ratings.
- **Per-job tests** (`apps/server/src/jobs/__tests__/catalog/*`): happy path, abort signal, admin trigger, cron skip-if-running. Reuse job-service test harness.
- **Per-row-fetcher integration**: cold catalog → live fallback path executes; warm catalog → DB-only path; assert ⊥ plugin invocation in warm case.
- **Hydrate-miss `partial: true` propagation**: rec list returns 60 ids, metadata batch returns 55 → response has 55 items + `partial: true`; cold-fill bounded by deadline; deadline-exceeded items emitted absent (not blocking).
- **Cold-fill write-back failure** (`catalog-provider.test.ts`): catalog write throws → `getItemFeatures` still returns features from plugin call; error logged; rebuild proceeds.
- **Eviction safety** (`prune.test.ts`): row referenced by in-flight rec build (item present in `recommendation_lists.items` written this minute) ⊥ pruned even if `last_accessed_at < now - 90d`. Prune builds ref set first, then filters.
- **Regression** (per `feedback#13`): extend `home-feed-warm-cache.test.ts` — first load builds catalog, second load hits catalog, third load **after process restart** still hits catalog (key behavior — Redis-less restart safety).
- **PE cold-fill bound**: miss → exactly one `MediaService.getMetadata`; write-back persists; second rebuild ⊥ plugin call.
- **Mirror sync diff**: full plugin fetch + mirror = N existing → only new events appended; replay sync ⊥ duplicate events; plugin failure preserves prior cursor.
- **Perf bound** (CI-smoke subset): nightly rec build for 100-user fixture < 30 min on SQLite WAL.

## Open questions / deferred

- **Multi-instance.** SQLite single-writer = single host. Postgres migration path = drizzle dialect swap + advisory-lock pattern (per job-service spec). Defer.
- **Cold-start latency.** First install = empty catalog, full live path on first home load. Acceptable v1; could prefetch popular discover at first-run. Also: rec candidates from `recommendations@v1` plugins land in `recommendation_lists.items` w/o prior catalog presence, then fill on first row read via `fillMissing` (deadline-bounded) — `metadata_refresh` only refreshes rows already in catalog. Bounded by user reload; user-triggered `feature.preference.rebuild` also fills via cold-fill path; live-fallback opportunistic write (below) closes the loop.
- **Profile-version mid-scroll reset UX.** `pv` mismatch resets to `p=0` silently; user on page 2 jumps to top of new list with no surface signal. Toast / "recommendations updated" banner deferred to v2.
- **Catalog growth bound.** Telemetry: row count + total bytes. Alert if > 50K rows / install (signal of un-pruned ref leak).
- **Mirror size cap.** Append-only blobs unbounded. 100K events ≈ 5MB blob; re-write per sync expensive at scale. Migration path: blob → row-per-event table (drizzle migration). Defer until observed.
- **Feature blob freshness.** TMDB keyword/cast lists shift; 30d refresh window means rec quality lags up to 30d. Tunable via `metadata_refresh` schedule. Acceptable v1.
- **Locale-keyed discover snapshots.** Out of v1.
- **Webhook-driven mirror sync.** Plugin support uneven (Trakt webhooks ∃; Plex/Jellyfin minimal). Scheduled poll covers all v1.
- **Cold-fill rate.** Metric on PE cold-fill frequency. If > expected (signal of prune too aggressive or refresh too lax), tune `90d` unused window or `30d` refresh window.
- **Snapshot tail beyond 60.** Today rows cap at 60. If product wants infinite-scroll, snapshot cap lifts to N or fall-through to live becomes ordered-merge problem. Out of v1.
- **`getAllHistory` cost on heavy users.** Trakt user w/ 10K history items pays 6h × full-fetch. Plex/Jellyfin same. Mitigate v2 by capability-level `since` extension where supported (Trakt) + connection-level config to limit window.
- **Live-fallback opportunistic catalog write.** Live discoverFeed / rank fallback paths could opportunistically populate `canonical_metadata` on the way through, accelerating warm-up. Deferred to v2 — keeps fallback paths zero-write so they're trivially equivalent to today's behavior on revert.

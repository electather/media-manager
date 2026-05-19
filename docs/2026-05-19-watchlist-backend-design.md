# Watchlist Backend Service

**Status:** design
**Date:** 2026-05-19
**Author:** Omid Astaraki
**Deps:** [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md), [2026-04-27-catalog-service-design.md](./2026-04-27-catalog-service-design.md), `frontend-feature-architecture` skill, plugin `watchlist@v1`

Caveman ultra. Pseudocode = shape-only, ⊥ literal.

## Problem

Watchlist page = mock data (`WATCHLIST_ITEMS` 25 hardcoded). ⊥ DB. ⊥ API. Add/remove ⊥ persist.
Home row `your-watchlist.ts` already pulls plugin watchlist@v1 → library-available filter, PAGE_SIZE=12. Different concern: watchlist page = full list, all states.

## Goal

- Internal DB table own user watchlist state.
- 3 RPCs: list / add / remove.
- Eager seed from plugin on first GET.
- Recurring per-user job sync new plugin items → internal (additive only v1).
- Client flat feature swap mock → real (frontend-feature-architecture).
- Moods = client-side genre derivation. Recent log = real (`addedAt` + `addedSource`).

## Non-goals

- Plugin writes (add → Trakt). v2.
- Bidirectional sync (plugin remove → internal remove). v2.
- User-curated mood clusters / mood persistence.
- Watchlist sharing.
- Sort persistence (URL state only).
- Cursor pagination v1 (cap 500 items, full list each GET).
- WebSocket invalidation.
- MCP surface change.

## Architecture

```
[client] ─ GET /api/watchlist ──► watchlist.service.getItems(userId, ctx)
                                  ├─ repo.list(userId, state="active")
                                  │     empty && !seedRow → service.seedFromPlugins
                                  ├─ enrich(rows, ctx)         — status/avail/progress
                                  └─ return { items, partial }

[client] ─ POST /api/watchlist ──► service.addItem(userId, key, source, ctx)
                                  ├─ repo.findByKey(userId, key)
                                  │     exists+active → 409 watchlist.duplicate
                                  │     exists+removed → repo.reactivate
                                  │     ⊥ exists       → repo.insertActive
                                  ├─ events.emit "watchlist.itemAdded"
                                  └─ enrich([row], ctx) → 201

[client] ─ DELETE /api/watchlist/:tmdbId/:mediaType ──► service.removeItem(userId, key)
                                  ├─ repo.findByKey || 404
                                  ├─ repo.softRemove(now)
                                  └─ events.emit "watchlist.itemRemoved" → 204

[job] watchlist.sync_plugin (per-user) ──► service.syncFromPlugins(userId, ctx)
                                  ├─ mediaService.getWatchlistFeed({ deadlineMs })
                                  ├─ repo.allKnownKeys(userId)      — active ∪ removed (⊥ resurrect)
                                  ├─ diff → newKeys
                                  ├─ repo.bulkInsertActive(newKeys, source="plugin")
                                  └─ { added, partial }
                                        partial=false → re-schedule 6h
                                        partial=true  → re-schedule 30m
```

Tombstone via `state` col → sync ⊥ resurrect deleted. Seed marker `user_watchlist_seed` separate → distinguishes "never seeded" from "seeded then user cleared all".

## §D Database

→ apps/server/src/db/schema/watchlist.ts (NEW)
→ apps/server/drizzle/00XX_add_watchlist.sql (NEW migration)

### D.1 `watchlist_items`

```
watchlist_items {
  id          text PK              // cuid
  user_id     text NOT NULL → users.id ON DELETE CASCADE
  tmdb_id     text NOT NULL
  media_type  text NOT NULL        // "movie" | "tv"
  state       text NOT NULL        // "active" | "removed"   ← tombstone
  added_at    int  NOT NULL        // ms epoch
  removed_at  int  NULLABLE        // ms epoch, set when state="removed"
  source      text NOT NULL        // WatchlistSource enum
  seeded      int  NOT NULL DEFAULT 0  // 1 = came from initial seed
}
UNIQUE (user_id, tmdb_id, media_type)
INDEX  (user_id, state)
INDEX  (user_id, added_at)   // recent log sort
```

State transitions:
- insert → state="active", added_at=now
- remove → state="removed", removed_at=now
- re-add → state="active", added_at=now, removed_at=null, source=new

Sync diff: known = SELECT (tmdb_id, media_type) WHERE user_id=? AND state IN ("active","removed"). Skip insert if in known.

### D.2 `user_watchlist_seed`

```
user_watchlist_seed {
  user_id   text PK → users.id ON DELETE CASCADE
  seeded_at int  NOT NULL  // ms epoch
}
```

Presence = "service.seedFromPlugins ran ≥1 time for this user". Service: `if !seedRow → seed → insertSeedRow`. ⊥ ambiguous w/ empty items.

### D.3 Schema export

Add to apps/server/src/db/schema/index.ts barrel.

## §M Module layout

→ apps/server/src/watchlist/ (NEW, ref [backend-feature-architecture](./2026-05-17-backend-feature-architecture-design.md))

```
watchlist/
  __tests__/
    service.test.ts
    sync-plugin-watchlist.test.ts
  jobs/
    sync-plugin-watchlist.ts
  repo.ts
  service.ts
  enrich.ts          // local thin enrich (no matchReason)
  errors.ts
  events.ts
  index.ts           // barrel: service public fns + types
```

Owned tables: `watchlist_items`, `user_watchlist_seed`. ⊥ outsiders read direct → must call `service.*`.

### M.1 repo.ts

```ts
list(userId, opts?: {includeRemoved?:boolean}) → WatchlistRow[]
findByKey(userId, key) → WatchlistRow | null
insertActive(userId, key, source) → WatchlistRow
reactivate(userId, key, source, now) → WatchlistRow      // state="active", added_at=now, removed_at=null
softRemove(userId, key, now) → void                       // state="removed", removed_at=now
bulkInsertActive(userId, keys[], source, seeded=0) → void // ⊥ overwrite existing
allKnownKeys(userId) → Set<`${tmdb_id}:${media_type}`>    // active+removed
hasSeeded(userId) → boolean
markSeeded(userId, now) → void
```

### M.2 service.ts

```ts
type Key = { tmdbId: string; mediaType: "movie"|"tv" }

getItems(userId, ctx) → { items: WatchlistItem[], partial: boolean }
  rows = repo.list(userId)
  if rows.empty && !repo.hasSeeded(userId):
    await seedFromPlugins(userId, ctx)
    rows = repo.list(userId)
  return enrich(rows, ctx)

addItem(userId, key, source, ctx) → WatchlistItem
  existing = repo.findByKey(userId, key)
  if existing?.state === "active" → throw DuplicateItemError
  row = existing
    ? repo.reactivate(userId, key, source, now())
    : repo.insertActive(userId, key, source)
  events.emit("watchlist.itemAdded", { userId, key, source })
  return enrich([row], ctx).items[0]

removeItem(userId, key) → void
  row = repo.findByKey(userId, key)
  if !row || row.state==="removed" → throw WatchlistNotFoundError
  repo.softRemove(userId, key, now())
  events.emit("watchlist.itemRemoved", { userId, key })

seedFromPlugins(userId, ctx) → { added: number, partial: boolean }
  feed = await mediaService.getWatchlistFeed({ deadlineMs: 5000 })
  keys = feed.items.slice(0, 500).map(toKey)   // cap 500 v1
  repo.bulkInsertActive(userId, keys, "plugin", seeded=1)
  repo.markSeeded(userId, now())
  scheduleSyncJob(userId)                       // first job enqueue
  return { added: keys.length, partial: feed.partial }

syncFromPlugins(userId, ctx) → { added: number, partial: boolean }
  feed = await mediaService.getWatchlistFeed({ deadlineMs: 5000 })
  known = repo.allKnownKeys(userId)             // ⊥ resurrect
  newKeys = feed.items.map(toKey).filter(k => !known.has(keyId(k)))
  repo.bulkInsertActive(userId, newKeys, "plugin", seeded=0)
  return { added: newKeys.length, partial: feed.partial }
```

### M.3 enrich.ts (local)

Watchlist ⊥ need matchReason → smaller surface than home enrich. Direct calls:

```ts
enrich(rows: WatchlistRow[], ctx) → { items: WatchlistItem[], partial: boolean }
  keys      = rows.map(toKey)
  metadata  = await catalogService.getMetadataBatch(keys)      // cold-fill on miss via mediaService.getMetadata
  status    = await statusBatch.resolve(keys, ctx.userId)      // shared util
  avail     = await mediaService.getAvailabilityBatch(keys)
  progress  = await mediaService.getProgressBatch(keys)
  return rows.map((row,i) => ({
    ...toCompact(metadata[i]),
    status: status[i],
    availability: avail[i],
    progress: progress[i],
    addedAt:     row.added_at,
    addedSource: row.source,
  }))
  partial = any(...partial flags from above)
```

Open: if duplication w/ home enrich grows, extract shared `enrich-base.ts` under `media/` or `shared/` zone. v1 = local copy ⊥ premature share.

### M.4 errors.ts

```
class WatchlistError extends Error { code: string }
class DuplicateItemError      extends WatchlistError { code = "watchlist.duplicate" }
class WatchlistNotFoundError  extends WatchlistError { code = "watchlist.not_found" }
class WatchlistBadInputError  extends WatchlistError { code = "watchlist.bad_input" }
```

### M.5 events.ts

```
emit("watchlist.itemAdded",   { userId, key, source })
emit("watchlist.itemRemoved", { userId, key })
```

Future notification listeners hook here. v1 = ⊥ subscribers.

### M.6 jobs/sync-plugin-watchlist.ts

```
jobKind  = "watchlist.sync_plugin"
payload  = { userId: string }

handler(ctx, payload):
  result = await service.syncFromPlugins(payload.userId, ctx)
  delay  = result.partial ? 30*60_000 : 6*60*60_000
  jobs.schedule({ kind: "watchlist.sync_plugin", payload, runAfter: now()+delay })
  return result
```

Register in jobs runtime (apps/server/src/jobs/registry).
Initial enqueue → from `service.seedFromPlugins` (one-shot, idempotent on jobs side).

## §W Wire contracts

→ packages/shared/src/watchlist/ (NEW subpath)

### W.1 Enums

```ts
WATCHLIST_SOURCES = [
  "manual","plugin","search","notification","recommended","trending"
] as const
type WatchlistSource = (typeof WATCHLIST_SOURCES)[number]
```

### W.2 Types

```ts
type WatchlistItem = CompactMediaItem & {
  addedAt:     number             // ms epoch
  addedSource: WatchlistSource
}

type WatchlistResponse = {
  items:   WatchlistItem[]
  partial: boolean                // plugin/enrich timeouts
}

type AddWatchlistRequest = {
  tmdbId:    string
  mediaType: "movie" | "tv"
  source?:   WatchlistSource      // default "manual"
}
```

### W.3 Subpath export

Add to packages/shared/package.json exports: `"./watchlist": "./src/watchlist/index.ts"`.

## §A API routes

→ apps/server/src/api/procedures/watchlist.ts (NEW)
→ register in apps/server/src/api/register-routes.ts

```
GET    /api/watchlist
  auth: session (required)
  → service.getItems(userId, ctx)
  → 200 WatchlistResponse

POST   /api/watchlist
  auth: session
  body: AddWatchlistRequest                       // zod-validated
  → service.addItem(userId, {tmdbId,mediaType}, body.source ?? "manual", ctx)
  → 201 WatchlistItem
  errors:
    400 watchlist.bad_input    — invalid tmdbId/mediaType/source
    409 watchlist.duplicate    — active row exists

DELETE /api/watchlist/:tmdbId/:mediaType
  auth: session
  → service.removeItem(userId, key)
  → 204
  errors:
    404 watchlist.not_found
```

Error envelope = unified shape (matches home): `{ error: { code, message } }`.

Hono RPC types → typed `api.watchlist.*` on client via existing `AppType`.

## §H Home row impact

`apps/server/src/home/rows/your-watchlist.ts` = **unchanged v1**.
- Continues `mediaService.getWatchlistFeed()` direct → plugin → library-avail filter.
- ⊥ delegate to watchlist service.

Reason: home row purpose ≠ watchlist page. Home shows quick-pick (avail only, 12). Watchlist page shows everything.

**Divergence risk:** user adds item manually in-app → ⊥ in home row until plugin write lands. Acceptable pre-stable. Flag for revisit when plugin writes added → home row → watchlist service.

## §C Client

→ apps/client/src/features/watchlist/ (flat layout, [frontend-feature-architecture](./2026-05-07-frontend-feature-architecture-skill-design.md))

```
features/watchlist/
  index.ts                              — barrel (cross-feature only)
  components/                           — existing sub-components
    watchlist-page.tsx                  — state owner (filter/sort/peek)
    watchlist-skeleton.tsx              — NEW, Suspense fallback
    watchlist-error-fallback.tsx        — NEW, ErrorBoundary fallback
    watchlist-toggle.tsx                — NEW (or extend existing), add/remove button
    tonight-pick.tsx, ready-row.tsx, mood-mosaic.tsx, awaiting.tsx,
    coming-up.tsx, recently-added.tsx, watchlist-filtered-grid.tsx ...
  hooks/                                — NEW dir, one hook per file
    use-watchlist-items.ts              — useSuspenseQuery
    use-add-to-watchlist.ts             — optimistic mutation
    use-remove-from-watchlist.ts        — optimistic mutation
  lib/
    fetchers.ts                         — NEW, api.watchlist.* wrappers + throwOnError
    query-keys.ts                       — NEW, watchlistKeys factory
    types.ts                            — existing + WatchlistApiError + sourceLabel
    classify.ts                         — existing (bucketize, deriveCounts)
    derive-moods.ts                     — NEW, genre → mood cluster
  __tests__/
    use-watchlist-items.test.ts
    use-add-to-watchlist.test.ts
    derive-moods.test.ts
  __fixtures__/
    watchlist-items.fixture.ts
  mock-data.ts                          — DELETE
```

### C.1 lib/fetchers.ts

```ts
list() → WatchlistResponse
  res = await api.watchlist.$get()
  throwOnError(res, WatchlistApiError); return res.json()

add(input: AddWatchlistRequest) → WatchlistItem
  res = await api.watchlist.$post({ json: input })
  throwOnError(res, WatchlistApiError); return res.json()

remove(tmdbId, mediaType) → void
  res = await api.watchlist[":tmdbId"][":mediaType"].$delete({ param })
  throwOnError(res, WatchlistApiError)
```

### C.2 lib/query-keys.ts

```ts
watchlistKeys = {
  all:  ["watchlist"] as const,
  list: () => [...watchlistKeys.all, "list"] as const,
}
```

### C.3 lib/types.ts (additions)

```ts
class WatchlistApiError extends Error {
  constructor(public status: number, public body: unknown, public code: string) {...}
}

sourceLabel(s: WatchlistSource) → string   // paraglide m.watchlist_source_*
```

### C.4 hooks/use-watchlist-items.ts

```ts
useWatchlistItems() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.list(),
    queryFn:  fetchers.list,
    staleTime: 60_000,
  })
}
```

### C.5 hooks/use-add-to-watchlist.ts (optimistic)

```ts
useAddToWatchlist() {
  qc = useQueryClient()
  return useMutation({
    mutationFn: fetchers.add,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: watchlistKeys.list() })
      prev = qc.getQueryData<WatchlistResponse>(watchlistKeys.list())
      optimistic = buildOptimistic(vars)             // minimal item w/ tmdbId+source+addedAt=now
      qc.setQueryData(watchlistKeys.list(), (old) =>
        old ? { ...old, items: [optimistic, ...old.items] } : old)
      return { prev }
    },
    onError:    (_e,_v,ctx) => qc.setQueryData(watchlistKeys.list(), ctx?.prev),
    onSettled:  () => qc.invalidateQueries({ queryKey: watchlistKeys.list() }),
  })
}
```

### C.6 hooks/use-remove-from-watchlist.ts

Mirror add: cancel → snapshot → filter-out optimistic → onError restore → onSettled invalidate.

### C.7 lib/derive-moods.ts

```ts
MOOD_RULES = [
  { id: "horror",       require: ["horror"] },
  { id: "slow-burn",    require: ["drama","thriller"] },     // AND
  { id: "quiet-thrill", require: ["mystery","thriller"] },
  { id: "scifi",        require: ["science fiction"] },
  { id: "period",       require: ["history"] },
  { id: "comedy",       require: ["comedy"] },
]

deriveMoods(items, opts?: { minItems?: 3 }) → MoodCluster[]
  rules.map(rule => {
    matches = items.filter(it => rule.require.every(g => it.genres?.includes(g)))
    return matches.length >= minItems ? { id: rule.id, items: matches } : null
  }).filter(Boolean)
```

Pure derivation. Item can appear in multi clusters. Labels via paraglide `m.mood_<id>`.

### C.8 Page wiring

```tsx
WatchlistPage:
  <ErrorBoundary FallbackComponent={WatchlistErrorFallback}>
    <Suspense fallback={<WatchlistSkeleton/>}>
      <WatchlistContent/>
    </Suspense>
  </ErrorBoundary>

WatchlistContent:
  { data } = useWatchlistItems()
  items = data.items
  // existing state: filter, sort, peek (URL params)
  buckets = bucketize(items, filter)
  moods   = deriveMoods(items)
  recent  = items.slice().sort(by addedAt DESC).slice(0,5)
  // render existing layout: tonight, ready, mood, coming-up, awaiting, recently-added
```

`partial` flag → render non-blocking banner ("some items couldn't load right now").

### C.9 Add/remove UX

`WatchlistToggle`:
- Reads cached list, computes `isInWatchlist = items.some(i => i.id === currentId)`
- Click → `useAddToWatchlist` or `useRemoveFromWatchlist`
- Optimistic flip (instant UI). Rollback on error → toast w/ `error.message`.

## §I i18n

All UI strings via paraglide `m.*`. New message keys:

```
m.watchlist_page_title
m.watchlist_filter_all / _ready / _in_progress / _awaiting / _upcoming
m.watchlist_sort_recent / _alpha / _runtime / _status
m.watchlist_source_manual / _plugin / _search / _notification / _recommended / _trending
m.mood_horror / _slow_burn / _quiet_thrill / _scifi / _period / _comedy
m.watchlist_partial_banner
m.watchlist_empty
m.watchlist_remove_error
m.watchlist_duplicate_error
```

## §T Tests

### T.1 Server

`watchlist/__tests__/service.test.ts`:
- getItems empty + ⊥seeded → triggers seedFromPlugins, returns enriched
- getItems empty + seeded → ⊥ re-seed, returns []
- addItem new → inserts, emits event
- addItem on removed → reactivates
- addItem on active → DuplicateItemError 409
- removeItem active → softRemove, emits event
- removeItem nonexistent → WatchlistNotFoundError 404
- removeItem then sync → ⊥ resurrect (key still in `allKnownKeys`)
- syncFromPlugins partial flag → returns partial:true ⊥ throw

`watchlist/__tests__/sync-plugin-watchlist.test.ts`:
- handler success → next-run scheduled at +6h
- handler partial → next-run scheduled at +30m
- mediaService rejection → handler catches → partial:true

### T.2 Client

- `use-watchlist-items.test.ts` — Suspense seed, error path → ErrorBoundary
- `use-add-to-watchlist.test.ts` — optimistic insert, rollback on 409, invalidate on settle
- `use-remove-from-watchlist.test.ts` — optimistic filter, rollback on err
- `derive-moods.test.ts` — AND rule matching, ≥3 threshold, multi-cluster overlap

Mock fetchers, ⊥ React Query.

## §F Failure modes

| Scenario | Behavior |
|---|---|
| Plugin watchlist@v1 ⊥ available on first GET | seed throws → caught → mark seeded=false (⊥ markSeeded) → return [] + partial:true. Next GET retries. |
| Plugin times out mid-sync | Job returns partial:true → re-schedules 30m. |
| User has 0 plugin connections w/ watchlist@v1 | `getWatchlistFeed` returns `{items:[], partial:false}` → markSeeded → ⊥ retry. User adds manually only. |
| Catalog miss during enrich | Cold-fill via mediaService.getMetadata (home pattern). Fail → fallback to tmdbId-only render + partial:true. |
| UI race double-add | Server 409 → client invalidates → corrected. |
| User removed item still in plugin feed | sync sees key in `allKnownKeys` (state=removed) → skip. Stays removed. |
| Plugin feed >500 items | Seed caps at 500 (newest first). Remaining synced on next job run if older items rotate. v1 acceptable. |
| Catalog has item, plugin says watchlist empty | Internal table = truth. Items stay (manually-added). |

## §R Rollout

Pre-stable: ⊥ compat shim, ⊥ data migration.

1. Migration `00XX_add_watchlist.sql` → tables + indexes.
2. Server module shipped (routes registered, ⊥ feature flag).
3. Job kind registered + handler.
4. Shared types subpath exported.
5. Client swap: delete `mock-data.ts`, wire fetchers/hooks/Suspense/ErrorBoundary.
6. First-load eager seed runs per-user on first watchlist page open. Sync job auto-enqueues post-seed.

Per-user state = empty → seeded on demand. ⊥ batch backfill.

## §O Open questions

1. **TMDB genre locale.** Match on English genre names (TMDB returns localized when `language` param set). Propose: enrich pipeline pulls genres in English (config), client labels via paraglide. Surface for confirm during impl.
2. **`source="notification"` writer.** Notification action infra supports custom action URLs → POST `/api/watchlist` w/ source="notification". ⊥ infra changes. Just spec POST body for action wiring.
3. **Cap 500 on seed.** Trakt watchlists can exceed. v1 takes newest 500. Counter ⊥ surfaced UI v1; add later.
4. **`enrich.ts` duplication w/ home.** Local copy v1. Extract to shared `media/` zone if 3rd consumer appears.
5. **Sort dropdown persistence.** URL state only v1. Add user_preferences col if requested.
6. **Direct `your-watchlist.ts` home-row coupling.** Diverges from watchlist service truth. Acceptable until plugin writes ship; revisit then.

## §X Future work

- Plugin writes: `watchlist@v1.addItem`/`removeItem` → bidirectional add path.
- Bidirectional sync (plugin remove → internal soft-remove).
- User-curated mood clusters (named groups, drag-drop).
- Watchlist sharing (link-share).
- Cursor pagination.
- Cross-device "added on X device" annotation.
- Notification action: "Add to watchlist" deep-link → POST w/ source="notification".

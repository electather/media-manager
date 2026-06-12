# Watchlist Backend Service

**Status:** design (rev 6) — partial supersession
**Date:** 2026-05-19 (rev 2: 2026-05-19, rev 3: 2026-05-19, rev 4: 2026-05-23, rev 5: 2026-05-26, rev 6: 2026-06-12)
**Author:** Omid Astaraki
**Deps:** [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md), [2026-04-27-catalog-service-design.md](./2026-04-27-catalog-service-design.md), [2026-04-20-job-service-design.md](./2026-04-20-job-service-design.md), `frontend-feature-architecture` skill ([.claude/skills/frontend-feature-architecture/SKILL.md](../.claude/skills/frontend-feature-architecture/SKILL.md)), `backend-feature-architecture` skill ([.claude/skills/backend-feature-architecture/SKILL.md](../.claude/skills/backend-feature-architecture/SKILL.md)), plugin `watchlist@v1`
**Partial supersession:** API surface + client layout sections superseded by [2026-05-23-watchlist-sections-design.md](./2026-05-23-watchlist-sections-design.md). Seed, sync, events semantics unchanged.

**Superseded / aligned (2026-05-26):** Backend ownership realigned by [2026-05-26-media-pipeline-consolidation-design.md](./2026-05-26-media-pipeline-consolidation-design.md). `media/` is now the FAT domain module: it OWNS the `watchlist_items` table (reads + writes + seed in `media/repo/`) AND the shared row pipeline (`MediaSource` + `media.listRows`). Concretely — (1) **writes** (`addItem`, `removeItem`, `seedFromPlugins`, `syncFromPlugins`) move to `media/service/writes.ts`, exported via the `media` barrel; watchlist calls the barrel and DELETES its own copies; (2) **table ownership** already transferred to `media`; (3) **reads** route through `media.listRows(source, cfg)` instead of the bespoke `getItems`/`enrich`/pagination described in §M.2–M.3; (4) **watchlist = thin product shell** (`sources/` + thin envelope `service.ts` + `moods/` + `tonight/` + `jobs/`). The §M.2/§M.3 read+write descriptions below are retained for history; treat the consolidation doc as authoritative for who owns each function. Seed/sync/event SEMANTICS (this doc) are unchanged — only the owning module moved.

Caveman ultra. Pseudocode = shape-only, ⊥ literal.

## Revision history

- **rev 6 (2026-06-12)** — Terminology and heading corrections to match current codebase.
  - `WatchlistRow` → `ActiveRow` in §M.1 and §M.3 pseudocode (rename landed after consolidation).
  - §M.3 heading updated: `enrich.ts (local, ⊥ home/internal import)` → `media/enrich.ts (shared media pipeline)` to reflect that enrich moved out of watchlist and into the shared `media/` pipeline.
  - §M.3 `enrich` return type annotated `CompactMediaItem[]` (was the stale `WatchlistItem[]`) to match the ownership note above it — `WatchlistItem` is deleted.
  - Service signatures `getItems`/`addItem`/`listAvailable` updated from `WatchlistItem` to the unified `CompactMediaItem` shape, consistent with the same ownership note. The historical `WatchlistItem` intersection type is retained only in the §Types appendix for reference.
- **rev 5 (2026-05-26)** — Align to `2026-05-26-media-pipeline-consolidation-design.md` (epic #491, folds #496).
  - Writes (`addItem`/`removeItem`/`seedFromPlugins`/`syncFromPlugins`) + `watchlist_items` table ownership → `media/` (`media/service/writes.ts` + `media/repo/`). Watchlist calls the `media` barrel; its own copies deleted.
  - Reads route through the shared `media.listRows(source, cfg)` pipeline. Bespoke `getItems`/`enrich`/keyset-pagination (§M.2–M.3) superseded by the media pipeline (`MediaSource` + `listRows`).
  - Watchlist = thin product shell: `sources/` + thin envelope `service.ts` (envelope + aggregates) + `moods/` + `tonight/` + `jobs/` (cache invalidation, sync-plugin-watchlist).
  - Seed, sync, event SEMANTICS unchanged — only the owning module moved.
- **rev 4 (2026-05-23)** — Partial supersession by `2026-05-23-watchlist-sections-design.md`.
  - `/api/watchlist?filter=` shape replaced by REST-split: `/items`, `/sections/{tonight,recently}`, `/moods`, `/moods/:moodId/items`. `?filter=` dropped (pre-stable).
  - Mood derivation moved server-side. Client `derive-moods.ts` deleted.
  - Tonight pick scored server-side; client receives pre-curated set.
  - Flat all-items view added (closes "watchlist page ⊥ list all items" gap).
  - Client layout adds `sections/` sub-folder under `components/`, plus `/watchlist/all` + `/watchlist/moods/:moodId` routes.
  - `inProgress` chip removal carried over from rev 3 caveat — same status.
  - Storage (§D), seed, sync, write paths (POST/DELETE), event schemas: unchanged.
- **rev 3 (2026-05-19)** — Address rev 2 review. Major descoping.
  - Job model → `registerScheduledPerRow` (cron + iteration). Drop invented `jobs.schedule({runAfter, dedupKey})`. Drop sweep job (cron handles recovery).
  - Drop `genreIds` end-to-end work (catalog schema, TMDB mapper, backfill). Mood derivation matches English genre names from existing `CompactMediaItem.genres: string[]`. Locale assumption documented.
  - Drop `media/batches.ts` extraction. Watchlist enrich calls `mediaService.getMatchingServers`/`getMetadata` directly w/ per-request memo (own instance). No `home/internal/*` import.
  - Use existing `emit(name, schema, payload)` bus. Drop invented `bus.makeEmitter`.
  - Drop `scheduleSeedBackoff` infra. Rely on plugin's `partial:true` + RQ stale window. Permanent-down handled by next user GET (cheap; plugin returns fast on no-cap).
  - Drop `DuplicateItemError` class (dead code v1).
  - `softRemove` returns void. `removeItem` on never-existed now 204 (fully idempotent).
  - `addItem` returns `{item, created, wasActive}` → route picks 201 (created/reactivated) vs 200 (already-active).
  - Home row eligibility = `hasAny(userId) || mediaService.hasCapabilityProvider("watchlist","v1","user")`.
  - `listAvailable` pre-filters by availability before full enrich → bounded fan-out.
  - Bulletize rev history (was: single sentence).
- **rev 2 (2026-05-19)** — Drop 500 seed cap. Resolve genre locale via numeric IDs (later reverted in rev 3). Switch §H to delegation. Fix enrich pseudo. Add seed-race handling. Promote events to rule-12 shape. Restrict POST `source`. Add tmdbId regex. `removeItem` idempotent. `WatchlistApiError extends BaseApiError`. Pre-mutate duplicate check.

## Problem

Watchlist page = mock data (`WATCHLIST_ITEMS` 25 hardcoded). ⊥ DB. ⊥ API. Add/remove ⊥ persist.
Home row `your-watchlist.ts` already pulls plugin watchlist@v1 → library-available filter, PAGE_SIZE=12. Different concern: watchlist page = full list, all states.

## Goal

- Internal DB table own user watchlist state.
- 3 RPCs: list / add / remove.
- Eager seed from plugin on first GET.
- Cron-driven per-user sync → internal (additive only v1).
- Client flat feature swap mock → real (frontend-feature-architecture).
- Moods = client-side genre-name derivation (English locale assumption). Recent log = real (`addedAt` + `addedSource`).
- Home row + watchlist page share service → single source of truth.

## Non-goals

- Plugin writes (add → Trakt). v2.
- Bidirectional sync (plugin remove → internal remove). v2.
- User-curated mood clusters / mood persistence.
- Watchlist sharing.
- Sort persistence (URL state only).
- WebSocket / SSE invalidation (RQ invalidate only).
- MCP surface change.
- Numeric-ID-stable mood derivation (requires catalog/plugin work; deferred).
- `home/internal/*` extraction to shared `media/` zone (orthogonal refactor).

## Architecture

```
[client] ─ GET /api/watchlist ──► watchlist.service.getItems(userId, ctx)
                                  ├─ rows = repo.list(userId, state="active")
                                  ├─ if rows.empty && !repo.hasSeeded(userId):
                                  │     if repo.trySeedLock(userId) → seedFromPlugins(ctx) → seed.partial
                                  │     else (lost race) → wait briefly, rows = repo.list(...)
                                  ├─ enrich(rows, ctx)              — status/avail/progress, per-req memo
                                  └─ return { items, partial: seed.partial || enrich.partial }

[client] ─ POST /api/watchlist ──► service.addItem(userId, key, source, ctx)
                                  ├─ zod validate (tmdbId /^\d+$/, mediaType enum, source ∈ USER_SOURCES)
                                  ├─ result = repo.upsertActive(userId, key, source, now)  — tx
                                  │     wasActive=true  → 200 (idempotent no-op, ⊥ event)
                                  │     wasActive=false → events.emit "watchlist.itemAdded"
                                  └─ enrich([row], ctx) → 200 (already-active) or 201 (created/reactivated)

[client] ─ DELETE /api/watchlist/:tmdbId/:mediaType ──► service.removeItem(userId, key)
                                  ├─ zod validate path params
                                  ├─ row = repo.findByKey(userId, key)
                                  │     !row || row.state==="removed" → 204 (idempotent, ⊥ event)
                                  ├─ repo.softRemove(userId, key, now)
                                  └─ events.emit "watchlist.itemRemoved" → 204

[job] watchlist.sync_plugin = registerScheduledPerRow(
        schedule: "0 */6 * * *",                            // every 6h
        rowSource: () => db.select(user_id).from(user_watchlist_seed),
        handler:   (ctx, {userId}) => service.syncFromPlugins(userId, ctx),
        continueOnRowError: true,
        perRowTimeoutSec: 30,
      )
```

Tombstone via `state` col → sync ⊥ resurrect deleted. Seed marker `user_watchlist_seed` separate → distinguishes "never seeded" from "seeded then user cleared all". Cron handles recurrence + survives deploys (no ad-hoc enqueue).

## §D Database

→ apps/server/src/db/schema/media/ (tables live here — ownership transferred to `media/` module, see `2026-05-20-backend-schema-namespaces-design.md`)
→ apps/server/drizzle/00XX_add_watchlist.sql (NEW migration)

### D.1 `watchlist_items`

```
watchlist_items {
  id          text PK              // cuid
  user_id     text NOT NULL → users.id ON DELETE CASCADE
  tmdb_id     text NOT NULL
  media_type  text NOT NULL        // enum tuple MEDIA_TYPES (shared)
  state       text NOT NULL        // enum tuple WATCHLIST_STATES = ["active","removed"]
  added_at    int  NOT NULL        // ms epoch
  removed_at  int  NULLABLE        // ms epoch, set when state="removed"
  source      text NOT NULL        // enum tuple WATCHLIST_SOURCES
  seeded      int  NOT NULL DEFAULT 0  // 1 = came from initial seed
}
UNIQUE (user_id, tmdb_id, media_type)
INDEX  (user_id, state, added_at)   // serves active-list + recent log sort
INDEX  (user_id, state)              // count queries
```

Drizzle: `text("col", { enum: TUPLE })` w/ shared `as const` tuples per CLAUDE.md.

State transitions (single row per `(user, item)` — UNIQUE):
- new add  → state="active", added_at=now, removed_at=null, source=new
- remove   → state="removed", removed_at=now (preserve added_at, source)
- re-add   → state="active", added_at=now, removed_at=null, source=new

**History caveat:** Re-add overwrites `added_at` + `source`. Recent-log shows latest-add only. v1 acceptable. Future: append-only `watchlist_events` table.

Sync diff: `known = SELECT (tmdb_id, media_type) FROM watchlist_items WHERE user_id=?` — UNIQUE ⇒ one row per pair regardless of state.

### D.2 `user_watchlist_seed`

```
user_watchlist_seed {
  user_id   text PK → users.id ON DELETE CASCADE
  seeded_at int  NOT NULL  // ms epoch
}
```

Presence = "seedFromPlugins ran ≥1 time". Separate table avoids cross-module ownership. Also = `rowSource` for the cron job.

**Concurrent-seed race:** `trySeedLock` = `INSERT INTO user_watchlist_seed (user_id, seeded_at) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING` then check affected rows. Inserter runs seed; loser falls through to re-read list. SQLite's `BEGIN IMMEDIATE` serializes writers — no spin loop needed.

### D.3 Schema export

Add to apps/server/src/db/schema/index.ts barrel. Tables originally owned by watchlist module; ownership transferred to the `media/` module (PR #526 — `2026-05-25-media-repo-extraction`) and accessed via `media/` barrel.

## §M Module layout

→ apps/server/src/watchlist/ (NEW, ref [backend-feature-architecture](./2026-05-17-backend-feature-architecture-design.md))

Target layout (post-`2026-05-26-media-pipeline-consolidation-design.md`): watchlist is a thin product shell. `repo.ts`, `enrich.ts`, and the write functions move to `media/` (`media/repo/`, `media/pipeline/`, `media/service/writes.ts`); `service.ts` shrinks to an envelope + aggregates that read via `media.listRows` and write via the `media` barrel.

```
watchlist/
  __tests__/
    service.test.ts
    sync-plugin-watchlist.test.ts
  sources/                             // persistent-table MediaSources: items, mood-items, tonight, recently
  moods/                               // derive, registry, cluster-summary (aggregate)
  tonight/                             // score, pick (ranking heuristic, runs inside source fetchRawSet)
  jobs/
    on-watchlist-mutation.ts          // cache invalidation
    sync-plugin-watchlist.ts          // registerScheduledPerRow
  service.ts                           // thin envelope: section wrap + aggregates (counts, mood-summary)
  errors.ts
  events.ts                            // const tuple + zod schemas
  index.ts                             // barrel: service public fns + types
```

Historical layout (this doc's original v1, before media consolidation): watchlist additionally owned `repo.ts`, `enrich.ts`, and the write functions in `service.ts`. Those moved to `media/` — see the consolidation doc §A. The §M.1–M.3 descriptions below document that original shape for history; treat the consolidation doc as authoritative for current ownership.

~~Owned tables: `watchlist_items`, `user_watchlist_seed`.~~ Storage ownership transferred to `media/` module (PR #526). Per `2026-05-26-media-pipeline-consolidation-design.md` (§A), `media/repo/` owns `watchlist_items` reads + writes + seed, and `media/service/writes.ts` owns the write functions (`addItem`/`removeItem`/`seedFromPlugins`/`syncFromPlugins`). Watchlist is a **thin product shell** — it calls the `media/` barrel for reads (`media.listRows`) and writes, and supplies its own `sources/`, envelope `service.ts`, `moods/`, and `tonight/`. Outside callers must use `service.*`. Fallow zone-pair enforces.

**Imports:** watchlist may import `media/` public surface (`media` barrel: `listRows`, write fns, `mediaService`), `catalog/` public surface (`catalogService`), shared types. ⊥ `home/internal/*`. `media` ⊥ import home/watchlist (no cycle).

### M.1 repo.ts

> **Ownership (2026-05-26):** moved to `media/repo/` — `media` owns `watchlist_items` reads + writes + seed. The signatures below are the contract; they now live behind the `media` barrel. See consolidation doc §A.

```ts
list(userId, opts?: {state?: WatchlistState}) → ActiveRow[]        // default state="active"
findByKey(userId, key) → ActiveRow | null                           // any state
upsertActive(userId, key, source, now) → { row: ActiveRow, created: boolean, wasActive: boolean }
softRemove(userId, key, now) → void                                    // UPDATE state="removed", removed_at=now WHERE state="active"
bulkInsertIgnoreConflict(userId, keys[], source, seeded) → number      // INSERT ... ON CONFLICT DO NOTHING. Returns affected.
allKnownKeys(userId) → Set<`${tmdb_id}:${media_type}`>
trySeedLock(userId, now) → boolean                                     // ON CONFLICT (user_id) DO NOTHING on user_watchlist_seed
hasSeeded(userId) → boolean
hasAny(userId) → boolean                                               // EXISTS active row
listAvailableKeys(userId, opts?: {limit?: number}) → ActiveRow[]    // active rows, no enrich (caller filters by avail)
```

**`upsertActive` semantics (SQLite, single tx):**
```
db.transaction(tx => {
  existing = tx.findByKey(userId, key)
  if existing?.state === "active":
    return { row: existing, created: false, wasActive: true }       // ⊥ mutate
  if existing?.state === "removed":
    updated = tx.update set state="active", added_at=now, removed_at=null, source=src
              where (user_id, tmdb_id, media_type) returning *
    return { row: updated, created: false, wasActive: false }
  inserted = tx.insert(id=cuid(), state="active", added_at=now, source=src) returning *
  return { row: inserted, created: true, wasActive: false }
})
```
`BEGIN IMMEDIATE` serializes concurrent writers; race losers re-read inside their own tx.

### M.2 service.ts

> **Ownership (2026-05-26):** split per consolidation doc §A/§H. **Writes** (`addItem`, `removeItem`, `seedFromPlugins`, `syncFromPlugins`) move to `media/service/writes.ts` and are exported via the `media` barrel — watchlist DELETES its copies and calls the barrel. **Reads** (`getItems` keyset paging + filter pre-classification, `listAvailable`) are superseded by the shared `media.listRows(source, cfg)` pipeline (`MediaSource` supplies the raw set; pipeline owns batch→enrich→classify→filter→sort→paginate). Aggregates (`getCounts`) route through media count-mode (`countBuckets`). The bespoke pseudocode below documents the original semantics; it is no longer watchlist-owned logic.

```ts
type Key = { tmdbId: string; mediaType: typeof MEDIA_TYPES[number] }

getItems(userId, { cursor, limit, filter }, ctx) → { items: CompactMediaItem[], cursor: string|null, partial: boolean }
  // Keyset pagination over (addedAt DESC, id DESC). `cursor` encodes the last
  // returned (addedAt, id) pair; `null` returns the first page. `filter` runs
  // a cheap pre-classification (status + availability via a per-request cache)
  // BEFORE the heavy enrich fan-out, so filtered pages don't burn enrich on
  // rows that the client would discard.
  seedPartial = false
  if cursor == null && !repo.hasSeeded(userId):
    if repo.trySeedLock(userId, now()):
      seedPartial = (await seedFromPlugins(userId, ctx)).partial
  // Overshoot the SQL window to give the filter room to drop non-matching
  // rows; retry up to 2 empty hops before exiting with cursor=null.
  fetchSize = filter && filter !== "all" ? limit * 3 : limit
  rows = repo.listPage(userId, { cursor, limit: fetchSize, state: "active" })
  if filter && filter !== "all":
    rows = await classify.preFilter(rows, filter, userId, ctx)
  enriched = await enrich(rows.slice(0, limit), ctx)
  nextCursor = rows.length > limit ? encodeCursor(rows[limit - 1]) : null
  return { items: enriched.items, cursor: nextCursor, partial: seedPartial || enriched.partial }

getCounts(userId, ctx) → WatchlistCounts
  // O(active rows) — pre-classifies the full active set via the per-request
  // availability cache so the header chips stay authoritative across pages.
  rows = repo.listAllActive(userId)
  return classify.aggregate(rows, userId, ctx)

addItem(userId, key, source, ctx) → { item: CompactMediaItem, created: boolean, wasActive: boolean }
  // source ∈ USER_SOURCES (enforced at route zod; service trusts caller).
  result = repo.upsertActive(userId, key, source, now())
  if !result.wasActive:
    await events.emit("watchlist.itemAdded", watchlistItemAddedSchema,
                      { userId, key, source, createdAt: now() })
  enriched = await enrich([result.row], ctx)
  return { item: enriched.items[0], created: result.created, wasActive: result.wasActive }

removeItem(userId, key) → void
  row = repo.findByKey(userId, key)
  if !row || row.state==="removed": return  // 204 idempotent
  repo.softRemove(userId, key, now())
  await events.emit("watchlist.itemRemoved", watchlistItemRemovedSchema,
                    { userId, key, removedAt: now() })

seedFromPlugins(userId, ctx) → { added: number, partial: boolean }
  try:
    feed = await ctx.mediaService.getWatchlistFeed({ deadlineMs: ctx.deadlineMs ?? 5000 })
  catch (err):
    ctx.log.warn("watchlist seed failed", { userId, err: err.message })
    // ⊥ markSeeded → next GET retries. No special backoff infra v1 — plugin call is cheap on failure.
    return { added: 0, partial: true }
  keys = feed.items.map(toKey)                                    // ⊥ cap
  inserted = repo.bulkInsertIgnoreConflict(userId, keys, "plugin", seeded=1)
  // hasSeeded is set by trySeedLock (called before this fn) — ⊥ separate markSeeded.
  return { added: inserted, partial: feed.partial }

syncFromPlugins(userId, ctx) → { added: number, partial: boolean }
  try:
    feed = await ctx.mediaService.getWatchlistFeed({ deadlineMs: ctx.deadlineMs ?? 10000 })
  catch (err):
    return { added: 0, partial: true }
  known = repo.allKnownKeys(userId)                               // all states → ⊥ resurrect
  newKeys = feed.items.map(toKey).filter(k => !known.has(keyId(k)))
  inserted = repo.bulkInsertIgnoreConflict(userId, newKeys, "plugin", seeded=0)
  return { added: inserted, partial: feed.partial }

// For home row delegation (see §H): pre-filter to bounded set before full enrich.
listAvailable(userId, limit, ctx) → { items: CompactMediaItem[], partial: boolean }
  rows = repo.listAvailableKeys(userId, { limit: limit * 4 })    // overshoot to allow filter
  if rows.empty:
    // Auto-seed when plugin has data but user never loaded /watchlist page.
    if !repo.hasSeeded(userId) && repo.trySeedLock(userId, now()):
      await seedFromPlugins(userId, ctx)
      rows = repo.listAvailableKeys(userId, { limit: limit * 4 })
  // Per-key avail probe (cheap; mediaService memo). Stop once limit reached.
  picked = []
  partial = false
  for row in rows:
    if picked.length >= limit: break
    avail = await ctx.mediaService.getMatchingServers(toKey(row), ctx.userId)
    if avail.hasAnyServerCopy: picked.push(row)
    if avail.partial: partial = true
  enriched = await enrich(picked, ctx)
  return { items: enriched.items, partial: partial || enriched.partial }

hasAny(userId) → boolean
  return repo.hasAny(userId)
```

Caller doc: `addItem` enrich cost = single-key fan-out (catalog + status + avail + progress for 1 item). Acceptable. Client may rely on the returned `item` + skip refetch invalidation if hot.

### M.3 media/enrich.ts (shared media pipeline)

> **Ownership (2026-05-26):** enrich is no longer watchlist-local. It is a stage of the shared `media` pipeline (`media/enrich.ts` + `media/pipeline` `batchLoad`), producing the single `CompactMediaItem` shape for every source. `WatchlistItem` is deleted — callers use the extended `CompactMediaItem` (`+ addedAt`/`addedSource`). See consolidation doc §C/§D. The pseudocode below documents the enrich semantics now owned by media.

```ts
enrich(rows: ActiveRow[], ctx) → { items: CompactMediaItem[] /* WatchlistItem deleted; see ownership note */, partial: boolean }
  if rows.empty: return { items: [], partial: false }
  keys = rows.map(r => ({ tmdbId: r.tmdb_id, mediaType: r.media_type }))
  let partial = false

  // metadata: existing batch on catalogService → Record<string, CanonicalMetadata>.
  metaMap = await ctx.catalogService.getMetadataBatch(keys)
  // cold-fill misses via mediaService (home pattern).
  for k of keys:
    id = keyId(k)
    if !metaMap[id]:
      try { metaMap[id] = await ctx.mediaService.getMetadata(k) }
      catch { partial = true; metaMap[id] = stubFromKey(k) }

  // Per-key fan-out via mediaService. Own per-request memo (Map<keyId, Promise>) to
  // dedupe within one enrich call (e.g. addItem then list returns same key).
  // Future opt: extract shared "media request cache" if 3rd consumer needs it.
  memo = new RequestMemo()
  results = await Promise.all(keys.map(async k => {
    id = keyId(k)
    avail    = memo.run(`avail:${id}`,    () => ctx.mediaService.getMatchingServers(k, ctx.userId))
    status   = memo.run(`status:${id}`,   () => ctx.mediaService.getRequestStatus(k, ctx.userId))
    progress = memo.run(`progress:${id}`, () => ctx.mediaService.getProgress(k, ctx.userId))
    [a, s, p] = await Promise.allSettled([avail, status, progress])
    if a.status==="rejected" || s.status==="rejected" || p.status==="rejected": partial = true
    return { availability: settled(a), status: settled(s), progress: settled(p) }
  }))

  items = rows.map((row, i) => ({
    ...toCompact(metaMap[keyId({tmdbId: row.tmdb_id, mediaType: row.media_type})]),
    availability: results[i].availability,
    status:       results[i].status,
    progress:     results[i].progress,
    addedAt:      row.added_at,
    addedSource:  row.source,
  }))
  return { items, partial }
```

**API verification during impl:** confirm `mediaService` exposes `getMatchingServers`, `getRequestStatus`, `getProgress` (single-key). If only batch variants exist on `mediaService`, adapt the call shape — same semantics, fewer round-trips. If neither exists, watchlist enrich emits a smaller payload (metadata + addedAt/addedSource only) and the client tolerates absent fields. ⊥ block this PR on cross-module batch extraction.

### M.4 errors.ts

```ts
class WatchlistError extends Error { code: string }
class WatchlistNotFoundError extends WatchlistError { code = "watchlist.not_found" }
```

Drop `DuplicateItemError` (v1 ⊥ strict endpoint).
Drop `WatchlistBadInputError` (zod validation → standard 400 envelope).

Mapping in `apps/server/src/api/procedures/watchlist.ts` (`onError`) per existing pattern: `{ error: { code, message } }`.

### M.5 events.ts

Direct `emit(name, schema, payload)` per existing bus (`apps/server/src/jobs/events.ts`):

```ts
export const WATCHLIST_EVENTS = ["watchlist.itemAdded", "watchlist.itemRemoved"] as const
export type WatchlistEvent = typeof WATCHLIST_EVENTS[number]

export const watchlistItemAddedSchema = z.object({
  userId:    z.string(),
  key:       z.object({ tmdbId: z.string(), mediaType: z.enum(MEDIA_TYPES) }),
  source:    z.enum(WATCHLIST_SOURCES),
  createdAt: z.number().int(),
})

export const watchlistItemRemovedSchema = z.object({
  userId:    z.string(),
  key:       z.object({ tmdbId: z.string(), mediaType: z.enum(MEDIA_TYPES) }),
  removedAt: z.number().int(),
})
```

Producers call `emit("watchlist.itemAdded", watchlistItemAddedSchema, payload)` direct (see `service.ts`). v1: ⊥ subscribers.

**Emit semantics:** events emit AFTER the repo transaction commits. If listener (future) throws, jobs runtime retries per existing `on(...)` dispatcher contract. If `emit` itself throws (zod bad payload, bus down), the row stays + event is lost. Document as at-most-once-after-commit v1. Hardening via outbox = future.

### M.6 jobs/sync-plugin-watchlist.ts

```ts
import { registerScheduledPerRow } from "../../jobs"

registerScheduledPerRow<{ userId: string }>({
  id:               "watchlist.sync_plugin",
  name:             "Watchlist plugin sync",
  description:      "Per-user: pull plugin watchlist@v1 and additively merge into internal table.",
  schedule:         "0 */6 * * *",                           // every 6h on hour
  rowSource:        async () => {
    rows = await db.select({ userId: user_watchlist_seed.user_id }).from(user_watchlist_seed)
    return rows
  },
  perRowTimeoutSec: 30,
  runTimeoutSec:    60 * 30,
  continueOnRowError: true,
  handler: async (ctx, { userId }) => {
    // syncFromPlugins now lives in media/service (consolidation doc §A) — called via media barrel.
    const result = await media.syncFromPlugins(userId, ctx)
    ctx.log.info("watchlist sync", { userId, added: result.added, partial: result.partial })
  },
})
```

The job stays in the watchlist shell's `jobs/` (alongside `on-watchlist-mutation.ts` cache invalidation, per consolidation doc §A); only the `syncFromPlugins` function it invokes moved to `media`.

**Recovery across deploys:** cron handles. Next tick re-enumerates seeded users. ⊥ sweep job needed.

**No ad-hoc enqueue from `seedFromPlugins`** — seed inserts the `user_watchlist_seed` row, cron picks up on next 6h tick. Worst-case lag = 6h before first auto-sync; user can manually add items at any time. Acceptable v1.

**Partial-failure behavior:** `continueOnRowError: true` → one user's plugin error ⊥ kill whole run. Partial flag logged but ⊥ shorter retry (next tick is just 6h). Acceptable v1 vs added complexity.

## §W Wire contracts

→ packages/shared/src/watchlist/ (NEW subpath)

### W.1 Enums

```ts
export const WATCHLIST_STATES = ["active", "removed"] as const
export type WatchlistState = typeof WATCHLIST_STATES[number]

export const WATCHLIST_SOURCES = [
  "manual", "plugin", "search", "notification", "recommended", "trending"
] as const
export type WatchlistSource = typeof WATCHLIST_SOURCES[number]

// Client-accepted subset (server rejects "plugin" via zod):
export const WATCHLIST_USER_SOURCES = [
  "manual", "search", "notification", "recommended", "trending"
] as const
export type WatchlistUserSource = typeof WATCHLIST_USER_SOURCES[number]
```

### W.2 Types

> **Aligned (2026-05-26):** `WatchlistItem` is **deleted** by the consolidation doc (§D). Its two extra fields fold into the existing `CompactMediaItem` as nullable wire fields (`addedAt?: number | null`, `addedSource?: WatchlistSource | null`) — one unified item shape across home + watchlist. The intersection type below is retained for history.

```ts
type WatchlistItem = CompactMediaItem & {
  addedAt:     number             // ms epoch
  addedSource: WatchlistSource
}

type WatchlistResponse = {
  items:   WatchlistItem[]
  cursor:  string | null          // keyset cursor; null = end of list
  partial: boolean                // seed/enrich partial flag
}

// Server-side filter pre-classification; matches client filter chip taxonomy
// so the server can drop non-matching rows BEFORE enrich, without falling back
// to a full-list fetch.
export const WATCHLIST_LIST_FILTERS = ["all", "ready", "awaiting", "upcoming"] as const
export type WatchlistListFilter = typeof WATCHLIST_LIST_FILTERS[number]

type AddWatchlistRequest = {
  tmdbId:    string               // /^\d+$/ enforced via zod
  mediaType: typeof MEDIA_TYPES[number]
  source?:   WatchlistUserSource  // default "manual" via zod
}

type AddWatchlistResponse = {
  item:      WatchlistItem
  created:   boolean              // true = brand-new row; false = reactivated or already-active
  wasActive: boolean              // true = no state change (already in watchlist)
}

// Cheap aggregate counts for the header pips. Powered by `/counts` so the
// client doesn't have to hold the full active set in memory just to render
// the header chips. `inProgress` is a strict subset of `ready`.
type WatchlistCounts = {
  ready:      number
  inProgress: number
  awaiting:   number
  upcoming:   number
  total:      number
}
```

`CompactMediaItem.genres: string[]` carries display names — used directly by client `derive-moods.ts` (English-locale assumption, see §O.1).

**`id` composite:** `CompactMediaItem.id` = `"movie:550"`. Client `useIsInWatchlist` checks composite. Shared helper `keyToId({tmdbId, mediaType}): string` exported.

### W.3 Subpath export

Add to packages/shared/package.json `exports`:
```json
"./watchlist": {
  "types":   "./src/watchlist/index.ts",
  "default": "./src/watchlist/index.ts"
}
```

### W.4 Validation schemas

```ts
addWatchlistRequestSchema = z.object({
  tmdbId:    z.string().regex(/^\d+$/, "tmdbId must be numeric"),
  mediaType: z.enum(MEDIA_TYPES),
  source:    z.enum(WATCHLIST_USER_SOURCES).default("manual"),     // single source of default
})

watchlistParamSchema = z.object({
  tmdbId:    z.string().regex(/^\d+$/),
  mediaType: z.enum(MEDIA_TYPES),
})
```

Service signature accepts `source: WatchlistUserSource` non-optional — zod fills default before call.

## §A API routes

→ apps/server/src/api/procedures/watchlist.ts (NEW)
→ register in apps/server/src/api/register-routes.ts (mounts at `/api/watchlist`)

```
GET    /api/watchlist
  auth:  session (required)
  rate:  default user-read tier
  query: cursor?  string                 — opaque keyset cursor
         limit?   number  (1..200)       — page size, default 60
         filter?  WatchlistListFilter    — server-side pre-classification ("all" default)
  → service.getItems(userId, { cursor, limit, filter }, ctx)
  → 200 WatchlistResponse                — items + cursor + partial

GET    /api/watchlist/counts
  auth:  session (required)
  rate:  default user-read tier
  → service.getCounts(userId, ctx)
  → 200 WatchlistCounts                  — header-pip aggregates over the full active set

POST   /api/watchlist
  auth:  session
  rate:  user-write tier (existing infra)
  body:  addWatchlistRequestSchema                          // zod → 400 standard envelope
  → result = service.addItem(userId, key, body.source, ctx)
  → 201 AddWatchlistResponse                                — result.wasActive === false (created or reactivated)
  → 200 AddWatchlistResponse                                — result.wasActive === true  (already-active; no event emitted)
  errors:
    400 zod envelope            — bad input

DELETE /api/watchlist/:tmdbId/:mediaType
  auth:  session
  rate:  user-write tier
  param: watchlistParamSchema
  → service.removeItem(userId, key)
  → 204                                                     (fully idempotent: removed, already-removed, or never-existed)
  errors:
    400 zod envelope            — bad path param
```

**Path vs query convention:** Existing home uses query params; watchlist DELETE uses path params for RESTful resource semantics + cleaner cache keys. Inconsistency intentional + isolated.

**Hono RPC:** `api.watchlist.$get()`, `api.watchlist.$post({json})`, `api.watchlist[":tmdbId"][":mediaType"].$delete({param})`. Verbose path-param syntax = Hono native.

**Error envelope** = standard `{ error: { code, message } }` shape (matches existing routes). Verify against `home.getDetails` 404 path during impl.

**Rate limit** = existing user-tier middleware. ⊥ new infra.

## §H Home row impact

> **Aligned (2026-05-26):** under the media pipeline (consolidation doc §A/§C), the `your-watchlist` home row becomes a `MediaSource` reading via `media.listRows`; the availability pre-filter is a pipeline `filter` stage rather than a bespoke `watchlistService.listAvailable`. Eligibility (`hasAny`/`hasCapabilityProvider`) stays a consumer-side concern (§B of the consolidation doc). The description below documents the original rev-2/3 wiring.

`apps/server/src/home/rows/your-watchlist.ts` = **rewires to `watchlistService.listAvailable`** (rev 2 stance, simplified in rev 3).

```ts
your-watchlist.eligibility(ctx):
  return await ctx.watchlistService.hasAny(ctx.userId)
      || await ctx.mediaService.hasCapabilityProvider("watchlist","v1","user")

your-watchlist.fetchPage(ctx, cursor):
  if cursor: return { items: [], cursor: null }                        // pagination = v2
  { items, partial } = await ctx.watchlistService.listAvailable(ctx.userId, PAGE_SIZE, ctx)
  return { items, cursor: null, partial }
```

Single source of truth: user adds in-app → home row sees it; user removes → home row hides.

`listAvailable` pre-filters availability per-key BEFORE full enrich → bounded fan-out (worst case = 4× `PAGE_SIZE` probes). Matches existing home row cost profile.

**Eligibility covers both paths:**
- User has plugin w/ `watchlist@v1` but never opened watchlist page → `hasCapabilityProvider` returns true → row eligible. `fetchPage` → `listAvailable` → triggers seed-if-needed.
- User added items manually w/o plugin → `hasAny` returns true → row eligible.
- User has nothing → neither true → row hidden.

**Pre-stable break:** home row sheds its direct `mediaService.getWatchlistFeed` call. Existing tests rewire to mock `watchlistService.listAvailable`.

## §C Client

→ apps/client/src/features/watchlist/ (flat layout, [frontend-feature-architecture](./2026-05-07-frontend-feature-architecture-skill-design.md))

**Layout rationale:** Watchlist page = single surface → flat. `WatchlistToggle` exported via barrel for cross-feature consumption (details modal, search, home rows). ⊥ requires split — split is for 2+ page surfaces, not cross-feature widgets.

```
features/watchlist/
  index.ts                              — barrel: WatchlistToggle, useAddToWatchlist, useRemoveFromWatchlist, useIsInWatchlist
  components/
    watchlist-page.tsx                  — state owner (filter/sort/peek)
    watchlist-content.tsx               — consumes useWatchlistItems (suspends)
    watchlist-skeleton.tsx              — NEW, Suspense fallback
    watchlist-error-fallback.tsx        — NEW, ErrorBoundary fallback
    watchlist-toggle.tsx                — NEW, cross-feature add/remove button
    tonight-pick.tsx, ready-row.tsx, mood-mosaic.tsx, awaiting.tsx,
    coming-up.tsx, recently-added.tsx, watchlist-filtered-grid.tsx ...
  hooks/
    use-watchlist-items.ts              — useSuspenseQuery
    use-is-in-watchlist.ts              — cache read (sync)
    use-add-to-watchlist.ts             — optimistic mutation
    use-remove-from-watchlist.ts        — optimistic mutation
  lib/
    fetchers.ts                         — NEW, api.watchlist.* + throwOnError
    query-keys.ts                       — NEW, watchlistKeys factory
    types.ts                            — WatchlistApiError + sourceLabel + buildOptimistic input type
                                          local mock `WatchlistItem` deleted; consumers import from shared
    classify.ts                         — existing
    derive-moods.ts                     — NEW, genre-name → mood cluster
    build-optimistic.ts                 — NEW, callers-pass minimal seed
  __tests__/
    use-watchlist-items.test.ts
    use-add-to-watchlist.test.ts
    use-remove-from-watchlist.test.ts
    derive-moods.test.ts
  __fixtures__/
    watchlist-items.fixture.ts
  mock-data.ts                          — DELETE
```

### C.1 lib/fetchers.ts

```ts
list({ cursor, limit, filter }) → WatchlistResponse
  res = await api.watchlist.$get({ query: { cursor, limit, filter } })
  throwOnError(res, WatchlistApiError); return res.json()

counts() → WatchlistCounts
  res = await api.watchlist.counts.$get()
  throwOnError(res, WatchlistApiError); return res.json()

add(input: AddWatchlistRequest) → AddWatchlistResponse
  res = await api.watchlist.$post({ json: input })
  throwOnError(res, WatchlistApiError); return res.json()

remove(tmdbId, mediaType) → void
  res = await api.watchlist[":tmdbId"][":mediaType"].$delete({ param: { tmdbId, mediaType } })
  throwOnError(res, WatchlistApiError)
```

### C.2 lib/query-keys.ts

```ts
watchlistKeys = {
  all:  ["watchlist"] as const,
  // Pagination + filter live in the list key so each filter chip gets its
  // own cache slot and "Load more" appends to the matching infinite query.
  list:   (filter: WatchlistListFilter = "all") => [...watchlistKeys.all, "list", filter] as const,
  counts: () => [...watchlistKeys.all, "counts"] as const,
}
```

### C.3 lib/types.ts additions

```ts
class WatchlistApiError extends BaseApiError {}     // reuse project convention
sourceLabel(s: WatchlistSource) → string            // paraglide m.watchlist_source_*
```

`BaseApiError` per existing client convention (admin-plugins, settings).

### C.4 hooks/use-watchlist-items.ts

```ts
useWatchlistItems(filter: WatchlistListFilter = "all") {
  // Keyset infinite query — Suspense reads the first page on mount; the row
  // list renders `pages.flatMap(p => p.items)` and "Load more" calls
  // fetchNextPage when `cursor !== null`.
  return useSuspenseInfiniteQuery({
    queryKey:        watchlistKeys.list(filter),
    queryFn:         ({ pageParam }) => fetchers.list({ cursor: pageParam, limit: 30, filter }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.cursor ?? undefined,
    staleTime:       60_000,                          // cross-tab/device stale window
  })
}

// Header chips read the dedicated `/counts` endpoint so they stay
// authoritative across paginated loads.
useWatchlistCounts() {
  return useSuspenseQuery({
    queryKey:  watchlistKeys.counts(),
    queryFn:   fetchers.counts,
    staleTime: 60_000,
  })
}
```

**Cross-device staleness:** No WebSocket → device A add ⇒ device B sees stale for up to 60s + window-focus refetch. v1 limitation; RQ default `refetchOnWindowFocus: true` mitigates.

### C.5 hooks/use-is-in-watchlist.ts

```ts
useIsInWatchlist(id: string) {                      // id = composite "movie:550"
  // `list("all")` is the unfiltered cache slot; membership is computed
  // against every loaded page so the answer is stable while the user pages
  // through the list.
  pages = qc.getQueryData<{ pages: WatchlistResponse[] }>(watchlistKeys.list("all"))
  return pages?.pages.some(p => p.items.some(i => i.id === id)) ?? false
}
```

Callers compose via shared `keyToId({tmdbId, mediaType})`.

### C.6 hooks/use-add-to-watchlist.ts (optimistic)

```ts
type AddOptimisticInput = {
  request: AddWatchlistRequest
  seed?:   Partial<WatchlistItem>                   // optional: callers w/ metadata pass seed for optimistic flip
}

useAddToWatchlist() {
  qc = useQueryClient()
  return useMutation({
    mutationFn: (input) => fetchers.add(input.request),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: watchlistKeys.list() })
      prev = qc.getQueryData<WatchlistResponse>(watchlistKeys.list())
      compositeId = keyToId(input.request)
      alreadyActive = prev?.items.some(i => i.id === compositeId)
      if alreadyActive || !input.seed:
        // Already in list OR caller has no metadata (e.g. notification deep-link) → skip optimistic.
        return { prev, skipped: true }
      optimistic = buildOptimistic(input.request, input.seed)
      qc.setQueryData(watchlistKeys.list(), (old) =>
        old ? { ...old, items: [optimistic, ...old.items] } : old)
      return { prev, skipped: false }
    },
    onError: (_e,_v,ctx) => {
      if (!ctx?.skipped && ctx?.prev) qc.setQueryData(watchlistKeys.list(), ctx.prev)
    },
    onSettled: (_d,_e,_v,ctx) => {
      // Skip refetch if we never wrote optimistically AND no server effect occurred
      // (server still ran — invalidate to pick up server-side normalization).
      qc.invalidateQueries({ queryKey: watchlistKeys.list() })
    },
  })
}
```

**Notification deep-link path:** action URL POSTs `{ tmdbId, mediaType, source: "notification" }` w/o seed. `onMutate` short-circuits optimistic → invalidate-only flow. UX flicker = ~1 RTT; acceptable for notification action.

### C.7 hooks/use-remove-from-watchlist.ts

Mirror add: cancel → snapshot → filter-out by composite id → onError restore → onSettled invalidate. ⊥ pre-check (filter-out is safe if absent).

### C.8 lib/derive-moods.ts (name-based, English-locale assumption)

```ts
// Catalog persists TMDB genre names (English by default — see §O.1).
const MOOD_RULES = [
  { id: "horror",       require: ["Horror"] },
  { id: "slow-burn",    require: ["Drama", "Thriller"] },    // AND
  { id: "quiet-thrill", require: ["Mystery", "Thriller"] },
  { id: "scifi",        require: ["Science Fiction"] },
  { id: "period",       require: ["History"] },
  { id: "comedy",       require: ["Comedy"] },
]

deriveMoods(items: WatchlistItem[], opts?: { minItems?: number }) → MoodCluster[]
  min = opts?.minItems ?? 3
  return MOOD_RULES.flatMap(rule => {
    matches = items.filter(it => rule.require.every(g => it.genres?.includes(g)))
    return matches.length >= min ? [{ id: rule.id, items: matches }] : []
  })
```

Items can appear in multiple clusters (intentional). Labels via paraglide `m.mood_<id>`.

**Locale fragility:** if catalog ever switches to localized genres (TMDB `language` param non-default), name match breaks. Future: capture numeric `genre_ids` on catalog write + match by ID (see §X).

### C.9 Page wiring

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
  buckets = bucketize(items, filter)
  moods   = deriveMoods(items)
  recent  = items.slice().sort(by addedAt DESC).slice(0,5)
  // existing layout: tonight, ready, mood, coming-up, awaiting, recently-added
```

`data.partial` → non-blocking banner via `m.watchlist_partial_banner`.

**ErrorBoundary scope:** catches Suspense-thrown fetch errors. Mutation errors → `onError` → toast. ⊥ propagate to ErrorBoundary.

### C.10 Add/remove UX

`WatchlistToggle` (exported from feature barrel):

```tsx
<WatchlistToggle item={compactMediaItem} source="search" />
```

- Reads `useIsInWatchlist(item.id)` (sync cache).
- Click → `useAddToWatchlist.mutate({ request, seed })` or `useRemoveFromWatchlist`.
- Optimistic flip (instant UI). Rollback → toast `m.watchlist_add_error` / `_remove_error`.

## §I i18n

All UI strings via paraglide `m.*`. New keys:

```
m.watchlist_page_title
m.watchlist_filter_all / _ready / _in_progress / _awaiting / _upcoming
m.watchlist_sort_recent / _alpha / _runtime / _status
m.watchlist_source_manual / _plugin / _search / _notification / _recommended / _trending
m.mood_horror / _slow_burn / _quiet_thrill / _scifi / _period / _comedy
m.watchlist_partial_banner
m.watchlist_empty
m.watchlist_tonight_pick_title
m.watchlist_ready_row_title
m.watchlist_mood_mosaic_title
m.watchlist_coming_up_title
m.watchlist_awaiting_title
m.watchlist_recently_added_title
m.watchlist_add_error
m.watchlist_remove_error
m.watchlist_toggle_add / _remove
```

Relative-time labels (e.g. "2h ago") computed client-side via `formatDistance` util → passed as plain `{value}` paraglide arg. ⊥ paraglide-function messages.

## §T Tests

### T.1 Server

`watchlist/__tests__/service.test.ts`:
- getItems empty + ⊥seeded → seedFromPlugins runs, returns enriched + seed.partial threaded
- getItems empty + seeded → ⊥ re-seed, returns []
- getItems concurrent first-GETs → only one calls seedFromPlugins (trySeedLock honored)
- addItem new → upsert insert, emits `watchlist.itemAdded` w/ schema
- addItem on removed → upsert reactivate, emits event, `wasActive=false`
- addItem on active → no-op, `wasActive=true`, ⊥ emit
- removeItem active → softRemove, emits event
- removeItem already-removed → 204 idempotent, ⊥ emit
- removeItem nonexistent → 204 idempotent, ⊥ emit
- removeItem then sync → ⊥ resurrect (key in `allKnownKeys`)
- seedFromPlugins plugin throws → returns partial:true, ⊥ markSeeded (trySeedLock already inserted seed-row though → re-seed safe via `bulkInsertIgnoreConflict`)
- syncFromPlugins partial → returns partial:true, ⊥ throw
- listAvailable pre-filters by availability before full enrich

`watchlist/__tests__/sync-plugin-watchlist.test.ts`:
- Job registers with cron schedule "0 */6 * * *"
- `rowSource` returns seeded users
- handler success per row → service called w/ userId
- handler error on one row → `continueOnRowError` honored, other rows still run

### T.2 Client

- `use-watchlist-items.test.ts` — Suspense seed, error → ErrorBoundary
- `use-add-to-watchlist.test.ts` — optimistic insert w/ seed, skip when caller passes no seed (notification path), rollback on err, invalidate on settle
- `use-remove-from-watchlist.test.ts` — optimistic filter, rollback on err
- `derive-moods.test.ts` — AND rule matching on names, ≥3 threshold, multi-cluster overlap

Mock fetchers (not RQ). Fixtures = `WatchlistItem[]` under `__fixtures__/`.

## §F Failure modes

| Scenario | Behavior |
|---|---|
| Plugin watchlist@v1 unavailable (transient) on first GET | seed catches → ⊥ data inserted, seed-row already inserted by trySeedLock → `hasSeeded=true`. Next GET ⊥ re-trigger seed. Sync cron tick @ +6h retries. Item-count starts at 0; user can add manually. |
| Plugin watchlist@v1 permanently absent (no plugin connected) | `getWatchlistFeed` returns `{items:[], partial:false}` → 0 inserts → user adds manually. |
| Plugin times out mid-sync | Job returns partial:true (logged); cron next tick retries @ +6h. |
| Job handler throws on a row | `continueOnRowError: true` → other rows continue. Next cron tick retries. |
| Job lost across deploy | Cron re-fires next tick on schedule. ⊥ sweep needed. |
| Catalog miss during enrich | Cold-fill via mediaService.getMetadata. Fail → stub from key + partial:true. UI renders tmdbId-only tile. |
| UI race double-add | Server idempotent UPSERT → 200 (wasActive=true). Client invalidates → no duplicate item. |
| User removed item still in plugin feed | sync sees key in `allKnownKeys` (state=removed) → skip insert. Stays removed. |
| Plugin feed returns duplicates | `bulkInsertIgnoreConflict` UNIQUE → second insert no-op. |
| Plugin feed >1000 items | All inserted (⊥ cap). Client virtualizes render. |
| Catalog has item, plugin feed empty | Internal table = truth. Items stay. |
| Concurrent first-GETs for same user | `trySeedLock` returns true to exactly one; others fall through to re-read. |
| Add then immediate remove | Final state = removed. Client optimistic flips, settles via invalidate. |
| seed inserts seed-row but plugin then throws | seed-row already committed → `hasSeeded=true`. ⊥ re-seed on next GET. Next cron tick retries plugin via syncFromPlugins. Acceptable. |

## §R Rollout

Pre-stable: ⊥ compat shim, ⊥ data migration.

1. Migration `00XX_add_watchlist.sql` → `watchlist_items` + `user_watchlist_seed` tables + indexes.
2. Shared package: add `packages/shared/src/watchlist/` (enums, types, schemas) + subpath export.
3. Server module `apps/server/src/watchlist/` shipped (routes, service, repo, enrich, events, cron job). Cron registered via `registerScheduledPerRow`.
4. Home row `your-watchlist.ts` rewired to `watchlistService.listAvailable`. Existing tests updated.
5. Client `apps/client/src/features/watchlist/`: delete mock-data.ts + local types, add fetchers/hooks/Suspense/ErrorBoundary/Toggle/derive-moods, wire page to real data.
6. Paraglide message keys added (English + existing locales as placeholders).

Per-user state starts empty → seeds on demand (first watchlist page open or first home-row fetch). ⊥ batch backfill.

## §O Open questions

1. **Catalog genre locale.** Today: catalog stores genre names from TMDB w/ default (English) language. Confirm during impl. If catalog ever localizes, mood derivation breaks → revisit by capturing numeric `genre_ids` on catalog write (deferred to §X).
2. **Notification deep-link allowlist.** Notification action URL validator (post-XSS-fix `5884c6f`) must allow POST `/api/watchlist`. Verify allowlist + same-origin policy before deep-link wiring. May need allowlist entry — small impl item, ⊥ blocker.
3. **`mediaService` per-key availability/status/progress API shape.** §M.3 calls `getMatchingServers`, `getRequestStatus`, `getProgress` per-key. Confirm method names + signatures during impl. If only batch variants exist, adapt enrich. If neither, watchlist enrich emits minimal payload (metadata + addedAt/addedSource); UI degrades gracefully.
4. **Cron `runTimeoutSec: 1800` (30m) for whole-run.** Verify generous enough at 100s of users × 30s perRowTimeout. May need `continueOnRowError` + parallelism tuning. Sizing during impl.
5. **Sort dropdown persistence.** URL state only v1. Add user_preferences col if requested.

## §X Future work

- Numeric `genre_ids` on catalog → locale-stable mood derivation by ID.
- Plugin writes: `watchlist@v1.addItem`/`removeItem` → bidirectional add path.
- Bidirectional sync (plugin remove → internal soft-remove).
- User-curated mood clusters (named groups, drag-drop).
- Append-only `watchlist_events` history (preserve add/remove timeline).
- Watchlist sharing (link-share).
- Cross-device "added on X device" annotation.
- WebSocket invalidation for cross-device live sync.
- Strict-mode POST endpoint that returns 409 instead of idempotent 200 (admin tooling). Reintroduce `DuplicateItemError`.
- Outbox for guaranteed at-least-once event delivery.
- Shared per-request media cache (extract memo from watchlist + home).

# Watchlist Backend Service

**Status:** design (rev 2)
**Date:** 2026-05-19 (rev 2: 2026-05-19)
**Author:** Omid Astaraki
**Deps:** [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md), [2026-04-27-catalog-service-design.md](./2026-04-27-catalog-service-design.md), `frontend-feature-architecture` skill ([.claude/skills/frontend-feature-architecture/SKILL.md](../.claude/skills/frontend-feature-architecture/SKILL.md)), `backend-feature-architecture` skill ([.claude/skills/backend-feature-architecture/SKILL.md](../.claude/skills/backend-feature-architecture/SKILL.md)), plugin `watchlist@v1`

Caveman ultra. Pseudocode = shape-only, ⊥ literal.

## Revision history

- **rev 2 (2026-05-19)** — Address review. Drop 500 cap (full plugin list seeded). Resolve genre-locale (numeric TMDB genre IDs via `genreIds` field). §H switched: home row delegates to watchlist service (single source of truth from day 1). Fix enrich pseudo (correct method names, Record indexing). Add seed-race handling, job idempotency key, outer try/catch, post-deploy sweep, jitter. Promote events to rule-12 shape (const tuple + zod). Restrict POST `source` (exclude `plugin`). Add tmdbId regex zod. `removeItem` idempotent. `WatchlistApiError extends BaseApiError`. Pre-mutate duplicate check. Cross-device staleness flagged. Drop `WatchlistBadInputError` (use zod 400). Add missing paraglide keys. Drop "newest first" claim.

## Problem

Watchlist page = mock data (`WATCHLIST_ITEMS` 25 hardcoded). ⊥ DB. ⊥ API. Add/remove ⊥ persist.
Home row `your-watchlist.ts` already pulls plugin watchlist@v1 → library-available filter, PAGE_SIZE=12. Different concern: watchlist page = full list, all states.

## Goal

- Internal DB table own user watchlist state.
- 3 RPCs: list / add / remove.
- Eager seed from plugin on first GET.
- Recurring per-user job sync new plugin items → internal (additive only v1).
- Client flat feature swap mock → real (frontend-feature-architecture).
- Moods = client-side genre derivation (numeric TMDB IDs). Recent log = real (`addedAt` + `addedSource`).
- Home row + watchlist page share service → single source of truth.

## Non-goals

- Plugin writes (add → Trakt). v2.
- Bidirectional sync (plugin remove → internal remove). v2.
- User-curated mood clusters / mood persistence.
- Watchlist sharing.
- Sort persistence (URL state only).
- Cursor pagination on GET (full list each call; client virtualizes).
- WebSocket / SSE invalidation (RQ invalidate only).
- MCP surface change.

## Architecture

```
[client] ─ GET /api/watchlist ──► watchlist.service.getItems(userId, ctx)
                                  ├─ acquireSeedLock(userId)        — single-flight first-seed
                                  ├─ repo.list(userId, state="active")
                                  │     empty && !seedRow → seedFromPlugins(userId, ctx)
                                  │                          → seed.partial threaded out
                                  ├─ enrich(rows, ctx)              — status/avail/progress
                                  └─ return { items, partial: seed.partial || enrich.partial }

[client] ─ POST /api/watchlist ──► service.addItem(userId, key, source, ctx)
                                  ├─ zod validate tmdbId /^\d+$/ + mediaType enum + source ∈ USER_SOURCES
                                  ├─ repo.upsertActive(userId, key, source) — single SQL UPSERT
                                  │     onConflict update state="active", added_at=now, removed_at=null, source=new
                                  │     onConflict-active-already → return existing → 200 (idempotent ⊥ 409)
                                  ├─ events.emit "watchlist.itemAdded"
                                  └─ enrich([row], ctx) → 201

[client] ─ DELETE /api/watchlist/:tmdbId/:mediaType ──► service.removeItem(userId, key)
                                  ├─ zod validate path params
                                  ├─ row = repo.findByKey(userId, key)
                                  │     !row → 404
                                  │     row.state==="removed" → 204 (idempotent)
                                  ├─ repo.softRemove(userId, key, now)
                                  └─ events.emit "watchlist.itemRemoved" → 204

[job] watchlist.sync_plugin (per-user) ──► handler:
                                  try {
                                    result = await service.syncFromPlugins(userId, ctx)
                                    delay  = result.partial ? PARTIAL_DELAY : SYNC_DELAY  // +jitter
                                  } catch {
                                    delay  = ERROR_DELAY   // bounded retry
                                  }
                                  jobs.schedule({ kind, payload, runAfter, dedupKey: `wl-sync:${userId}` })

[sweep] watchlist.sync_sweep (host singleton, daily) ──► for each user where seeded && !pending(sync_plugin):
                                                          jobs.schedule(sync_plugin, dedupKey)
```

Tombstone via `state` col → sync ⊥ resurrect deleted. Seed marker `user_watchlist_seed` separate → distinguishes "never seeded" from "seeded then user cleared all". Sweep recovers users whose recurring job is lost across deploys.

## §D Database

→ apps/server/src/db/schema/watchlist.ts (NEW)
→ apps/server/drizzle/00XX_add_watchlist.sql (NEW migration)

### D.1 `watchlist_items`

```
watchlist_items {
  id          text PK              // cuid
  user_id     text NOT NULL → users.id ON DELETE CASCADE
  tmdb_id     text NOT NULL
  media_type  text NOT NULL        // enum tuple MEDIA_TYPES
  state       text NOT NULL        // enum tuple WATCHLIST_STATES = ["active","removed"]
  added_at    int  NOT NULL        // ms epoch
  removed_at  int  NULLABLE        // ms epoch, set when state="removed"
  source      text NOT NULL        // enum tuple WATCHLIST_SOURCES
  seeded      int  NOT NULL DEFAULT 0  // 1 = came from initial seed
}
UNIQUE (user_id, tmdb_id, media_type)
INDEX  (user_id, state, added_at)   // serves active-list + recent log sort
INDEX  (user_id, state)              // serves count queries
```

Drizzle column defs use `text("col", { enum: TUPLE })` per CLAUDE.md (shared `as const` tuples). Tuples live in `packages/shared/src/watchlist/enums.ts`.

State transitions (single row per `(user, item)` — UNIQUE):
- new add  → state="active", added_at=now, removed_at=null, source=new
- remove   → state="removed", removed_at=now (preserve added_at, source)
- re-add   → state="active", added_at=now, removed_at=null, source=new

**History caveat:** Re-add overwrites `added_at` + `source`. Recent-log shows latest-add only. v1 acceptable. Future: append-only `watchlist_events` table if history needed.

Sync diff: `known = SELECT (tmdb_id, media_type) FROM watchlist_items WHERE user_id=?` — UNIQUE means one row per pair regardless of state, so no state filter needed.

### D.2 `user_watchlist_seed`

```
user_watchlist_seed {
  user_id   text PK → users.id ON DELETE CASCADE
  seeded_at int  NOT NULL  // ms epoch
}
```

Presence = "service.seedFromPlugins ran ≥1 time". Separate table > flag-on-users-table → avoids cross-module ownership (auth zone vs watchlist zone). ⊥ ambiguous w/ empty items.

**Concurrent-seed race:** Two GETs in flight before first commit → both see no seedRow. Defense: `INSERT ... ON CONFLICT (user_id) DO NOTHING RETURNING *` on seed-row insert is the single-flight gate. Loser sees `RETURNING` empty → skips its own seed run, refetches list (other tx will have inserted items).

### D.3 Schema export

Add to apps/server/src/db/schema/index.ts barrel. Owned exclusively by watchlist module.

## §M Module layout

→ apps/server/src/watchlist/ (NEW, ref [backend-feature-architecture](./2026-05-17-backend-feature-architecture-design.md))

```
watchlist/
  __tests__/
    service.test.ts
    sync-plugin-watchlist.test.ts
    sync-sweep.test.ts
  jobs/
    sync-plugin-watchlist.ts
    sync-sweep.ts
  repo.ts
  service.ts
  enrich.ts          — local thin enrich (⊥ matchReason)
  errors.ts
  events.ts          — const tuple + zod schemas (rule 12)
  index.ts           — barrel: service public fns + types
```

Owned tables: `watchlist_items`, `user_watchlist_seed`. ⊥ outsiders read direct → must call `service.*`. Fallow zone-pair enforces.

**Rule 8 (no `home/internal/*` imports):** enrich helpers shared w/ home (status batch, availability batch) live in `media/` zone, not `home/internal`. If not yet there, extract during impl (see §M.3 note).

### M.1 repo.ts

```ts
list(userId, opts?: {state?:WatchlistState}) → WatchlistRow[]   // default state="active"
findByKey(userId, key) → WatchlistRow | null                     // returns regardless of state
upsertActive(userId, key, source, now) → { row: WatchlistRow, created: boolean, wasActive: boolean }
  // single UPSERT:
  // INSERT INTO watchlist_items (id, user_id, tmdb_id, media_type, state, added_at, source)
  //   VALUES (cuid(), ?, ?, ?, "active", now, ?)
  // ON CONFLICT (user_id, tmdb_id, media_type) DO UPDATE
  //   SET state="active", added_at=now, removed_at=NULL, source=excluded.source
  //   WHERE watchlist_items.state="removed"     // ⊥ overwrite already-active
  // RETURNING *, (xmax=0) AS created            // SQLite: use RETURNING + secondary fetch to detect existing-active
softRemove(userId, key, now) → boolean                            // returns true if affected row, false if already-removed/missing
bulkInsertIgnoreConflict(userId, keys[], source, seeded) → number // INSERT ... ON CONFLICT DO NOTHING. Returns rows inserted.
allKnownKeys(userId) → Set<`${tmdb_id}:${media_type}`>
listAvailableForHomeRow(userId, limit, ctx) → WatchlistRow[]      // active + library-avail filter (delegated check via ctx)
trySeedLock(userId, now) → boolean                                 // ON CONFLICT DO NOTHING on user_watchlist_seed; true if inserted
hasSeeded(userId) → boolean
```

**`upsertActive` semantics (SQLite):**
```
tx:
  existing = findByKey(userId, key)
  if existing?.state === "active":  return { row: existing, created: false, wasActive: true }
  if existing?.state === "removed": reactivate via UPDATE → return { row: updated, created: false, wasActive: false }
  else:                              INSERT → return { row: inserted, created: true,  wasActive: false }
```
Wrapped in immediate transaction → UNIQUE-conflict race resolves at commit time, loser retries findByKey. Drizzle `db.transaction(...)`.

### M.2 service.ts

```ts
type Key = { tmdbId: string; mediaType: typeof MEDIA_TYPES[number] }

getItems(userId, ctx) → { items: WatchlistItem[], partial: boolean }
  rows = repo.list(userId, { state: "active" })
  seedPartial = false
  if rows.empty && !repo.hasSeeded(userId):
    lockAcquired = repo.trySeedLock(userId, now())
    if lockAcquired:
      seedPartial = (await seedFromPlugins(userId, ctx)).partial
    // else: another req seeded; fall through to re-read
    rows = repo.list(userId, { state: "active" })
  enriched = await enrich(rows, ctx)
  return { items: enriched.items, partial: seedPartial || enriched.partial }

addItem(userId, key, source, ctx) → { item: WatchlistItem, created: boolean }
  // source restricted by zod at route layer to USER_SOURCES (no "plugin")
  result = repo.upsertActive(userId, key, source, now())
  if !result.wasActive:
    events.emit("watchlist.itemAdded", { userId, key, source, createdAt: now() })
  enriched = await enrich([result.row], ctx)
  return { item: enriched.items[0], created: result.created }

removeItem(userId, key) → { removed: boolean }
  row = repo.findByKey(userId, key)
  if !row → throw WatchlistNotFoundError              // never existed
  if row.state==="removed" → return { removed: false } // idempotent: 204 either way
  repo.softRemove(userId, key, now())
  events.emit("watchlist.itemRemoved", { userId, key, removedAt: now() })
  return { removed: true }

seedFromPlugins(userId, ctx) → { added: number, partial: boolean }
  try {
    feed = await ctx.mediaService.getWatchlistFeed({ deadlineMs: ctx.deadlineMs ?? 5000 })
  } catch (err) {
    // Plugin permanent-down or unrecoverable → don't markSeeded → next GET retries.
    // Bounded retry via `seed_attempt` ephemeral cache (memory or short TTL) to prevent
    // every GET re-hammering plugin if always-down. Backoff: 30s → 5min → 30min cap.
    if isTransient(err): scheduleSeedBackoff(userId, err)
    return { added: 0, partial: true }
  }
  keys = feed.items.map(toKey)                          // ⊥ cap, ⊥ assume ordering
  inserted = repo.bulkInsertIgnoreConflict(userId, keys, "plugin", seeded=1)
  repo.markSeeded(userId, now())
  enqueueSyncJob(userId)                                // dedup key prevents double-enqueue
  return { added: inserted, partial: feed.partial }

syncFromPlugins(userId, ctx) → { added: number, partial: boolean }
  feed = await ctx.mediaService.getWatchlistFeed({ deadlineMs: ctx.deadlineMs ?? 5000 })
  known = repo.allKnownKeys(userId)                     // all states → ⊥ resurrect removed
  newKeys = feed.items.map(toKey).filter(k => !known.has(keyId(k)))
  inserted = repo.bulkInsertIgnoreConflict(userId, newKeys, "plugin", seeded=0)
  return { added: inserted, partial: feed.partial }

// For home row delegation (see §H):
listAvailable(userId, limit, ctx) → { items: WatchlistItem[], partial: boolean }
  rows = repo.list(userId, { state: "active" })
  enriched = await enrich(rows, ctx)
  available = enriched.items.filter(i => i.availability?.hasAnyServerCopy)
  return { items: available.slice(0, limit), partial: enriched.partial }
```

`addItem` enrich cost note: each call fans out catalog+status+avail+progress for 1 item. Click-spam = N round-trips. Acceptable v1 (rate-limit at gateway, see §A). If hot, batch via debounce on client.

### M.3 enrich.ts (local)

Watchlist ⊥ need matchReason → smaller surface than home enrich. Real method shapes:

```ts
enrich(rows: WatchlistRow[], ctx) → { items: WatchlistItem[], partial: boolean }
  if rows.empty → return { items: [], partial: false }
  keys = rows.map(r => ({ tmdbId: r.tmdb_id, mediaType: r.media_type }))
  let partial = false

  // metadata: Record<keyId, CanonicalMetadata | null>
  metaMap = await ctx.catalogService.getMetadataBatch(keys)
  // cold-fill misses via ctx.mediaService.getMetadata (home pattern)
  for k where metaMap[keyId(k)] == null:
    try { metaMap[keyId(k)] = await ctx.mediaService.getMetadata(k) }
    catch { partial = true; metaMap[keyId(k)] = stubFromKey(k) }

  // status/availability/progress: lifted into media/ zone (was home/internal/status-batch).
  // Extract during impl if not yet shared (rule-8 prohibits home/internal import).
  // Resulting helpers: media.batchStatus, media.batchAvailability, media.batchProgress.
  // Each returns Record<keyId, T> and surfaces own partial flag.
  status   = await ctx.media.batchStatus(keys, ctx.userId)        // { map, partial }
  avail    = await ctx.media.batchAvailability(keys, ctx.userId)  // { map, partial }
  progress = await ctx.media.batchProgress(keys, ctx.userId)      // { map, partial }
  partial = partial || status.partial || avail.partial || progress.partial

  items = rows.map(row => {
    keyId_ = `${row.tmdb_id}:${row.media_type}`
    return {
      ...toCompact(metaMap[keyId_]),                              // id, tmdbId, mediaType, title, year, poster, etc.
      status:       status.map[keyId_],
      availability: avail.map[keyId_],
      progress:     progress.map[keyId_],
      genreIds:     metaMap[keyId_]?.genreIds ?? [],              // numeric TMDB ids for moods
      addedAt:      row.added_at,
      addedSource:  row.source,
    }
  })
  return { items, partial }
```

`media.batchStatus/Availability/Progress` are extracted from `home/internal/*` into `apps/server/src/media/batches.ts` during impl. Home enrich also rewires to consume from media zone — refactor scoped to this PR.

### M.4 errors.ts

```ts
class WatchlistError extends Error { code: string }
class DuplicateItemError      extends WatchlistError { code = "watchlist.duplicate" }   // reserved for future strict-mode endpoint
class WatchlistNotFoundError  extends WatchlistError { code = "watchlist.not_found" }
```

Drop `WatchlistBadInputError` — zod validation at route layer returns standard 400 envelope via existing `diagnostics/validator`, ⊥ need watchlist-specific code.

Mapping in `apps/server/src/api/procedures/watchlist.ts` (`onError` block) per existing home pattern: `{ error: { code, message } }`.

### M.5 events.ts (rule-12 shape)

```ts
export const WATCHLIST_EVENTS = ["watchlist.itemAdded", "watchlist.itemRemoved"] as const
export type WatchlistEvent = typeof WATCHLIST_EVENTS[number]

export const watchlistItemAddedSchema = z.object({
  userId: z.string(),
  key: z.object({ tmdbId: z.string(), mediaType: z.enum(MEDIA_TYPES) }),
  source: z.enum(WATCHLIST_SOURCES),
  createdAt: z.number().int(),
})

export const watchlistItemRemovedSchema = z.object({
  userId: z.string(),
  key: z.object({ tmdbId: z.string(), mediaType: z.enum(MEDIA_TYPES) }),
  removedAt: z.number().int(),
})

export const emitWatchlistEvent = bus.makeEmitter({
  "watchlist.itemAdded":   watchlistItemAddedSchema,
  "watchlist.itemRemoved": watchlistItemRemovedSchema,
})
```

Emitter wraps existing event bus (matches notifications pattern). Async-safe dispatch (sync emit throws on listener err = bad). v1: ⊥ subscribers.

### M.6 jobs/sync-plugin-watchlist.ts

```ts
const SYNC_DELAY    = 6 * 60 * 60_000     // 6h base
const PARTIAL_DELAY = 30 * 60_000          // 30min on partial
const ERROR_DELAY   = 60 * 60_000          // 1h on unexpected throw
const JITTER_MAX    = 5 * 60_000           // ±5min

const jobKind = "watchlist.sync_plugin"
const payload = { userId: string }

export async function handler(ctx, payload):
  let nextDelay = SYNC_DELAY
  try {
    result = await service.syncFromPlugins(payload.userId, ctx)
    nextDelay = result.partial ? PARTIAL_DELAY : SYNC_DELAY
    ctx.log.info("watchlist sync", { userId: payload.userId, added: result.added, partial: result.partial })
  } catch (err) {
    nextDelay = ERROR_DELAY
    ctx.log.error("watchlist sync threw", { userId: payload.userId, err })
  } finally {
    runAfter = now() + nextDelay + randomJitter(JITTER_MAX)
    await ctx.jobs.schedule({
      kind: jobKind,
      payload,
      runAfter,
      dedupKey: `wl-sync:${payload.userId}`,   // idempotent — no double-enqueue
    })
  }
```

**Idempotency:** `dedupKey` rejects scheduling if pending job w/ same key exists. Existing jobs runtime must support this (per [job-service-design](./2026-04-20-job-service-design.md)). Verify during impl.

**Initial enqueue** = `service.seedFromPlugins` calls `enqueueSyncJob(userId)` → `jobs.schedule({ kind, payload, runAfter: now()+SYNC_DELAY+jitter, dedupKey })`. Idempotent.

### M.7 jobs/sync-sweep.ts (post-deploy recovery)

```ts
const jobKind = "watchlist.sync_sweep"
const SWEEP_INTERVAL = 24 * 60 * 60_000

export async function handler(ctx):
  seeded = await db.select(user_id).from(user_watchlist_seed)
  for userId in seeded:
    pending = await ctx.jobs.findByDedupKey(`wl-sync:${userId}`)
    if !pending:
      await ctx.jobs.schedule({
        kind: "watchlist.sync_plugin",
        payload: { userId },
        runAfter: now() + randomJitter(SWEEP_INTERVAL / 2),  // spread load
        dedupKey: `wl-sync:${userId}`,
      })
  ctx.jobs.schedule({ kind, runAfter: now() + SWEEP_INTERVAL, dedupKey: "wl-sweep" })
```

Recovers users whose recurring `watchlist.sync_plugin` was lost in a deploy that purged in-flight jobs. Daily host-singleton.

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

// Subset accepted from clients (no "plugin" — server-only):
export const WATCHLIST_USER_SOURCES = [
  "manual", "search", "notification", "recommended", "trending"
] as const
export type WatchlistUserSource = typeof WATCHLIST_USER_SOURCES[number]
```

### W.2 Types

```ts
type WatchlistItem = CompactMediaItem & {
  genreIds:    number[]           // numeric TMDB genre IDs (stable, locale-free)
  addedAt:     number             // ms epoch
  addedSource: WatchlistSource
}

type WatchlistResponse = {
  items:   WatchlistItem[]
  partial: boolean                // plugin/enrich timeout or seed partial
}

// AddWatchlistRequest accepts WatchlistUserSource only.
type AddWatchlistRequest = {
  tmdbId:    string               // /^\d+$/ enforced via zod
  mediaType: typeof MEDIA_TYPES[number]
  source?:   WatchlistUserSource  // default "manual"
}
```

**`id` collision note:** `CompactMediaItem.id` is composite (`"movie:550"`). Client `WatchlistToggle.isInWatchlist` checks composite id — callers must pass composite, not raw tmdbId. Helper `keyToId({tmdbId, mediaType})` exported from shared.

**`genreIds` source:** Already on TMDB metadata blob (numeric, locale-stable). Enrich pipeline carries them on `CompactMediaItem`. If `CompactMediaItem` ⊥ have `genreIds` today, add it (pre-stable break OK).

### W.3 Subpath export

Add to packages/shared/package.json `exports`:
```json
"./watchlist": {
  "types": "./src/watchlist/index.ts",
  "default": "./src/watchlist/index.ts"
}
```

### W.4 Validation schemas

```ts
addWatchlistRequestSchema = z.object({
  tmdbId:    z.string().regex(/^\d+$/, "tmdbId must be numeric"),
  mediaType: z.enum(MEDIA_TYPES),
  source:    z.enum(WATCHLIST_USER_SOURCES).optional(),
})

watchlistParamSchema = z.object({
  tmdbId:    z.string().regex(/^\d+$/),
  mediaType: z.enum(MEDIA_TYPES),
})
```

## §A API routes

→ apps/server/src/api/procedures/watchlist.ts (NEW)
→ register in apps/server/src/api/register-routes.ts (mounts under `/api/watchlist`)

```
GET    /api/watchlist
  auth:  session (required)
  rate:  default per-user (config from common middleware)
  → service.getItems(userId, ctx)
  → 200 WatchlistResponse

POST   /api/watchlist
  auth:  session
  rate:  stricter (e.g. 30/min/user — match existing mutation endpoints)
  body:  addWatchlistRequestSchema                        // zod → 400 standard envelope
  → service.addItem(userId, {tmdbId,mediaType}, body.source ?? "manual", ctx)
  → 201 WatchlistItem            (newly added or reactivated)
  → 200 WatchlistItem            (already-active row → idempotent OK ⊥ 409)
  errors:
    400 standard zod envelope  — invalid input

DELETE /api/watchlist/:tmdbId/:mediaType
  auth:  session
  rate:  stricter (30/min/user)
  param: watchlistParamSchema
  → service.removeItem(userId, key)
  → 204                          (removed or already-removed; idempotent)
  errors:
    400 standard zod envelope  — invalid path param
    404 watchlist.not_found    — never existed for user
```

**Path vs query convention:** Existing home routes use query params (`?tmdbId=&mediaType=`). Watchlist DELETE uses path params for RESTful resource semantics + cleaner cache keys. Inconsistency is intentional + small. Document in [api-conventions]. POST takes JSON body (matches notifications/requests POST routes).

**Hono RPC ergonomics:** `api.watchlist.$get()`, `api.watchlist.$post({json})`, `api.watchlist[":tmdbId"][":mediaType"].$delete({param})`. Hono path-param syntax is verbose but typed end-to-end.

**Error envelope** = standard `{ error: { code, message } }` (matches existing routes). Verified during impl against `home.getDetails` 404 path.

**Rate limit** = default user-tier middleware (existing infra). Watchlist mutations slot at the existing "user write" tier. ⊥ new infra.

## §H Home row impact

`apps/server/src/home/rows/your-watchlist.ts` = **rewires to call `watchlistService.listAvailable(userId, 12, ctx)`** (rev 2 change).

```
home row your-watchlist.fetchPage(ctx, cursor):
  if cursor → return paginated continuation (post-v1)
  { items, partial } = await ctx.watchlistService.listAvailable(ctx.userId, PAGE_SIZE, ctx)
  return { items, cursor: null, partial }
```

Reason: single source of truth from day 1. User adds item in-app → home row sees it. User removes in-app → home row hides it. No divergence.

Cost: home row gains a service dep on watchlist module. Boundary OK — home consumes watchlist's public service surface (not internals). Fallow zone rule: home → watchlist public allowed.

**Plugin-only users:** If user ⊥ seeded yet, `listAvailable` triggers seed (same getItems path). Acceptable — home page load may see seed-cost first time. Subsequent loads = cached items + enrich.

## §C Client

→ apps/client/src/features/watchlist/ (flat layout, [frontend-feature-architecture](./2026-05-07-frontend-feature-architecture-skill-design.md))

**Layout rationale:** Watchlist page = single surface → flat. `WatchlistToggle` is rendered from other features (details modal, search, home rows) — exported via barrel for cross-feature consumption, ⊥ requires split.

```
features/watchlist/
  index.ts                              — barrel: WatchlistToggle, useAddToWatchlist, useRemoveFromWatchlist
  components/                           — existing sub-components
    watchlist-page.tsx                  — state owner (filter/sort/peek)
    watchlist-content.tsx               — consumes useWatchlistItems (suspends)
    watchlist-skeleton.tsx              — NEW, Suspense fallback
    watchlist-error-fallback.tsx        — NEW, ErrorBoundary fallback
    watchlist-toggle.tsx                — NEW, cross-feature add/remove button
    tonight-pick.tsx, ready-row.tsx, mood-mosaic.tsx, awaiting.tsx,
    coming-up.tsx, recently-added.tsx, watchlist-filtered-grid.tsx ...
  hooks/                                — NEW dir, one hook per file
    use-watchlist-items.ts              — useSuspenseQuery
    use-is-in-watchlist.ts              — derived from cache (sync)
    use-add-to-watchlist.ts             — optimistic mutation
    use-remove-from-watchlist.ts        — optimistic mutation
  lib/
    fetchers.ts                         — NEW, api.watchlist.* wrappers + throwOnError
    query-keys.ts                       — NEW, watchlistKeys factory
    types.ts                            — existing watchlist-local types + WatchlistApiError + sourceLabel
                                          local `WatchlistItem` deleted; import from shared subpath
    classify.ts                         — existing (bucketize, deriveCounts)
    derive-moods.ts                     — NEW, genreIds → mood cluster
    build-optimistic.ts                 — NEW, callers-pass minimal item helper
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
list() → WatchlistResponse
  res = await api.watchlist.$get()
  throwOnError(res, WatchlistApiError); return res.json()

add(input: AddWatchlistRequest) → WatchlistItem
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
  list: () => [...watchlistKeys.all, "list"] as const,
}
```

### C.3 lib/types.ts additions

```ts
class WatchlistApiError extends BaseApiError {}   // reuse project convention (status, body)
// `code` parsed from body in BaseApiError; ⊥ new constructor signature

sourceLabel(s: WatchlistSource) → string          // paraglide m.watchlist_source_*
```

`BaseApiError` lives in `apps/client/src/shared/lib/api-error.ts` (or per existing convention). Local `WatchlistItem` type (current mock-data scaffold) deleted; consumers import `WatchlistItem` from `@ent-mcp/shared/watchlist`.

### C.4 hooks/use-watchlist-items.ts

```ts
useWatchlistItems() {
  return useSuspenseQuery({
    queryKey: watchlistKeys.list(),
    queryFn:  fetchers.list,
    staleTime: 60_000,         // cross-tab/cross-device stale window; see Limitations
  })
}
```

**Cross-device staleness:** No WebSocket → user adds on device A, device B reads stale list for up to 60s + window-focus refetch. v1 limitation. RQ default `refetchOnWindowFocus: true` mitigates active use.

### C.5 hooks/use-is-in-watchlist.ts (cache read)

```ts
useIsInWatchlist(id: string) {
  data = qc.getQueryData<WatchlistResponse>(watchlistKeys.list())
  return data?.items.some(i => i.id === id) ?? false
}
```

`id` = composite `"movie:550"` (matches `CompactMediaItem.id`). Caller uses `keyToId({tmdbId, mediaType})` helper to compose.

### C.6 hooks/use-add-to-watchlist.ts (optimistic)

```ts
useAddToWatchlist() {
  qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddOptimisticInput) => fetchers.add(input.request),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: watchlistKeys.list() })
      prev = qc.getQueryData<WatchlistResponse>(watchlistKeys.list())
      // Pre-check duplicate to avoid flicker: if already-in-cache, short-circuit (no optimistic insert).
      alreadyActive = prev?.items.some(i => i.id === keyToId(input.request))
      if alreadyActive: return { prev, skipped: true }
      optimistic = buildOptimistic(input)   // caller passes minimal CompactMediaItem-shaped seed (title/poster/year/genreIds)
      qc.setQueryData(watchlistKeys.list(), (old) =>
        old ? { ...old, items: [optimistic, ...old.items] } : old)
      return { prev, skipped: false }
    },
    onError:    (_e,_v,ctx) => ctx?.prev && qc.setQueryData(watchlistKeys.list(), ctx.prev),
    onSettled:  () => qc.invalidateQueries({ queryKey: watchlistKeys.list() }),
  })
}

type AddOptimisticInput = {
  request: AddWatchlistRequest
  seed:    Pick<CompactMediaItem, "id" | "title" | "year" | "poster" | "genreIds" | "mediaType" | "tmdbId">
}
```

**Caller responsibility:** Add originates from a context that already has metadata (details modal, search result, home tile, recommendations row). Caller passes that metadata as `seed` → `buildOptimistic` produces a `WatchlistItem` shape. ⊥ refetch metadata to build optimistic item.

### C.7 hooks/use-remove-from-watchlist.ts

Mirror add: cancel → snapshot → filter-out by composite id → onError restore → onSettled invalidate. No pre-check needed (filtering by id is safe if absent).

### C.8 lib/derive-moods.ts (genreId-based)

```ts
// TMDB numeric genre IDs (stable, locale-free).
const G = { HORROR:27, DRAMA:18, THRILLER:53, COMEDY:35, MYSTERY:9648, SCIFI:878, HISTORY:36 }

MOOD_RULES = [
  { id: "horror",       require: [G.HORROR] },
  { id: "slow-burn",    require: [G.DRAMA, G.THRILLER] },     // AND
  { id: "quiet-thrill", require: [G.MYSTERY, G.THRILLER] },
  { id: "scifi",        require: [G.SCIFI] },
  { id: "period",       require: [G.HISTORY] },
  { id: "comedy",       require: [G.COMEDY] },
]

deriveMoods(items: WatchlistItem[], opts?: { minItems?: number }) → MoodCluster[]
  min = opts?.minItems ?? 3
  return MOOD_RULES.flatMap(rule => {
    matches = items.filter(it => rule.require.every(g => it.genreIds.includes(g)))
    return matches.length >= min ? [{ id: rule.id, items: matches }] : []
  })
```

Pure derivation. Items can appear in multiple clusters (intentional — slow-burn drama can also be quiet-thrill). Labels via paraglide `m.mood_<id>`. Numeric IDs decouple from TMDB locale.

### C.9 Page wiring

```tsx
WatchlistPage:
  <ErrorBoundary FallbackComponent={WatchlistErrorFallback}>     // catches suspense-thrown fetch errors
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

`partial: true` → non-blocking banner via `m.watchlist_partial_banner`. ⊥ block render.

**ErrorBoundary scope:** Catches Suspense thrown errors (initial fetch). Mutation errors go to `onError` and surface as toasts — ⊥ propagate to ErrorBoundary.

### C.10 Add/remove UX

`WatchlistToggle` (exported from feature barrel):

```tsx
<WatchlistToggle item={compactMediaItem} source="search" />
```

- Reads `useIsInWatchlist(item.id)` (cache, sync)
- Click → `useAddToWatchlist.mutate({ request, seed })` or `useRemoveFromWatchlist`
- Optimistic flip (instant UI). Rollback on error → toast w/ `m.watchlist_remove_error` / `m.watchlist_add_error`.

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
m.watchlist_tonight_pick_title
m.watchlist_ready_row_title
m.watchlist_mood_mosaic_title
m.watchlist_coming_up_title
m.watchlist_awaiting_title
m.watchlist_recently_added_title
m.watchlist_recently_added_relative      // {minutes} m ago, {hours} h ago — function-typed
m.watchlist_add_error
m.watchlist_remove_error
m.watchlist_duplicate_error
m.watchlist_toggle_add / _remove
```

## §T Tests

### T.1 Server

`watchlist/__tests__/service.test.ts`:
- getItems empty + ⊥seeded → seedFromPlugins runs, returns enriched + seed.partial propagated
- getItems empty + seeded → ⊥ re-seed, returns []
- getItems concurrent first-GETs → only one seeds (seed lock honored)
- addItem new → upsert insert, emits event
- addItem on removed → upsert reactivate, emits event
- addItem on active → 200 idempotent, ⊥ emit duplicate event
- removeItem active → softRemove, emits event, returns 204
- removeItem already-removed → 204 idempotent, ⊥ emit
- removeItem nonexistent → 404 WatchlistNotFoundError
- removeItem then sync → ⊥ resurrect (key still in `allKnownKeys`)
- seedFromPlugins plugin throws transient → returns partial:true, ⊥ markSeeded, ⊥ enqueueJob
- seedFromPlugins plugin throws permanent → backoff cache hit, ⊥ re-call plugin within window
- syncFromPlugins partial flag → returns partial:true, ⊥ throw

`watchlist/__tests__/sync-plugin-watchlist.test.ts`:
- handler success → next-run scheduled at +6h + jitter, dedupKey set
- handler partial → next-run scheduled at +30m + jitter
- handler throws → next-run scheduled at +1h (ERROR_DELAY)
- handler runs w/ existing pending dedupKey → ⊥ double-enqueue

`watchlist/__tests__/sync-sweep.test.ts`:
- seeded users without pending sync → enqueued
- seeded users with pending sync → skipped
- sweep self-reschedules daily

### T.2 Client

- `use-watchlist-items.test.ts` — Suspense seed, error → ErrorBoundary
- `use-add-to-watchlist.test.ts` — optimistic insert, pre-check duplicate (no flicker), rollback on err, invalidate on settle
- `use-remove-from-watchlist.test.ts` — optimistic filter, rollback on err
- `derive-moods.test.ts` — AND rule matching on numeric ids, ≥3 threshold, multi-cluster overlap

Mock fetchers (not React Query). Fixtures = `WatchlistItem[]` arrays under `__fixtures__/`.

## §F Failure modes

| Scenario | Behavior |
|---|---|
| Plugin watchlist@v1 ⊥ available on first GET (transient) | seed catches → ⊥ markSeeded → return [] + partial:true. Backoff cache (30s → 5min → 30min) prevents per-GET retry storm. Next GET past backoff retries. |
| Plugin watchlist@v1 permanently absent (no plugin connected) | `getWatchlistFeed` returns `{items:[], partial:false}` → markSeeded → ⊥ retry. User adds manually only. |
| Plugin times out mid-sync (job) | Job returns partial:true → re-schedules 30m + jitter. |
| Job handler throws (DB down, bus down) | Outer catch → re-schedule 1h + jitter. ⊥ permanent job death. |
| Job lost across deploy (pending purged) | Daily `watchlist.sync_sweep` re-enqueues for all seeded users. |
| Catalog miss during enrich | Cold-fill via mediaService.getMetadata (home pattern). Fail → stub from key + partial:true. Render shows tmdbId-only tile. |
| UI race double-add | Server idempotent UPSERT → 200 instead of 409 → client invalidates → no duplicate item. |
| User removed item still in plugin feed | sync sees key in `allKnownKeys` (any state) → skip insert. Stays removed. |
| Plugin feed returns same item twice | `bulkInsertIgnoreConflict` UNIQUE → second insert no-op. |
| Plugin feed >1000 items | All inserted (⊥ cap). Client virtualizes render. v1 acceptable. |
| Catalog has item, plugin feed empty | Internal table = truth. Items stay (manually-added). |
| Concurrent first-GETs for same user | `trySeedLock` (ON CONFLICT DO NOTHING on user_watchlist_seed) → exactly one runs seed; others fall through to re-read. |
| Add then immediate remove (race) | Server: addItem returns 201 → removeItem 204. Final state = removed. Client optimistic flips, then settles to invalidated truth. |
| Sync job DB-tx fails partway | Rollback. Re-enqueue via outer catch. Idempotent next run. |

## §R Rollout

Pre-stable: ⊥ compat shim, ⊥ data migration.

1. Migration `00XX_add_watchlist.sql` → tables + indexes.
2. Extract `status/availability/progress` batches from `home/internal` to `media/batches.ts` (rule-8 compliance). Rewire home enrich to consume from media.
3. Add `genreIds: number[]` to shared `CompactMediaItem` + populate in catalog write path.
4. Server module shipped (routes registered, ⊥ feature flag). `watchlist.sync_plugin` + `watchlist.sync_sweep` registered. Sweep enqueued once on first deploy.
5. Shared types subpath exported (`@ent-mcp/shared/watchlist`).
6. Home row rewired to `watchlistService.listAvailable`.
7. Client swap: delete `mock-data.ts`, delete client-local `WatchlistItem`, wire fetchers/hooks/Suspense/ErrorBoundary/Toggle, derive moods from `genreIds`.

Per-user state = empty → seeded on demand. ⊥ batch backfill. Sweep ensures recurring sync survives deploys.

## §O Open questions

1. **Job runtime `dedupKey` support.** Verify existing jobs runtime supports per-kind dedupKey on schedule (per [job-service-design](./2026-04-20-job-service-design.md)). If absent, implement (or use payload-hash workaround).
2. **`source="notification"` writer.** Notification action URL validator (post-XSS-fix `5884c6f`) must allow internal POST `/api/watchlist`. Verify allowlist + same-origin requirement before deep-link wiring. May need allowlist entry.
3. **Where does `genreIds` come from on existing catalog rows?** TMDB returns numeric ids natively. Confirm catalog write path captures + persists. Migration backfills `genre_ids` column if not already on `canonical_metadata`.
4. **`enrich.ts` duplication w/ home.** Local copy v1 (status/avail/progress already extracted to `media/` in §R step 2). matchReason-specific logic stays in home enrich. Acceptable.
5. **Sort dropdown persistence.** URL state only v1. Add user_preferences col if requested.
6. **Backoff cache storage.** `scheduleSeedBackoff` cache: in-memory per-process OK for single-host; needs distributed cache (or DB row) for multi-host. Verify host topology before impl.

## §X Future work

- Plugin writes: `watchlist@v1.addItem`/`removeItem` → bidirectional add path.
- Bidirectional sync (plugin remove → internal soft-remove via diff).
- User-curated mood clusters (named groups, drag-drop).
- Append-only `watchlist_events` history table (preserve add/remove timeline).
- Watchlist sharing (link-share).
- Cursor pagination on GET (cap render-side, server returns subset).
- Cross-device "added on X device" annotation.
- WebSocket invalidation for cross-device live sync.
- Strict-mode POST endpoint that returns 409 instead of idempotent 200 (admin tooling).

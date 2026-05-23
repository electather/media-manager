# Watchlist Sections — REST-split + Flat All-Items

**Status:** design (rev 2)
**Date:** 2026-05-23 (rev 1: 2026-05-23, rev 2: 2026-05-23)
**Author:** Omid Astaraki
**Supersedes (partial):** [2026-05-19-watchlist-backend-design.md](./2026-05-19-watchlist-backend-design.md) §I.api + client layout. Storage, seed, sync, events unchanged.
**Deps:** [2026-05-19-watchlist-backend-design.md](./2026-05-19-watchlist-backend-design.md), [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md), [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), `frontend-feature-architecture` skill, `backend-feature-architecture` skill.

Caveman ultra. Pseudo = shape only, ⊥ literal.

## Revision history

- **rev 2 (2026-05-23)** — Address rev 1 review.
  - In-progress chip + `WatchlistCounts.inProgress` semantics pinned (§C.6).
  - `MoodSummaryCluster` wire shape + client `MOOD_REGISTRY` ownership pinned (§W, §C.4).
  - Mood `/moods/:moodId/items` default `limit=60` (max 200) + cluster threshold `MIN_CLUSTER_SIZE=3` for `/moods` filtering pinned (§I.api, §S.3).
  - Alpha sort dropped from keyset → in-memory join w/ catalog title (no `title_norm` column, no backfill). Only `recent` uses keyset; alpha/runtime/status all use offset-snapshot cursors (§S.1, V.WL1).
  - Pre-stable break: added explicit grep step over `packages/plugins/*` + `packages/plugin-sdk/` before `WatchlistListFilter` rename (§M Phase 1 prelude).
  - Cache invalidation listeners moved to `watchlist/jobs/on-watchlist-mutation.ts`, registered via `registerJobs()` mirror of notifications pattern (§S.4).
  - Empty-hop overshoot factored into reusable helper, reused by `listMoodItems` (§S.3).
  - Route loader hits `/counts` only; Tonight becomes first below-loader Suspense child instead of loader payload (§C.1, §C.5).
  - Component layout flattened: single-file sections sit directly in `components/sections/<name>.tsx`; only `mood-mosaic/` keeps a folder (§C.4).
  - V.WL5/V.WL6/V.WL7 test rows added (§T).
  - Changeset: single user-facing client changeset; server marked internal-only empty frontmatter (§M Phase 5).
- **rev 1 (2026-05-23)** — Initial sectioning design.

## Problem

Watchlist page ⊥ render full list. Symptoms:
- "all" view = curated sections only (Tonight, Ready, Mood, Coming Up, Awaiting, Recently). Each capped client-side (Recently=5, MoodCluster=3, Tonight=1+4).
- `bucketize` drops items classified "unknown" → invisible. `counts.total` includes them.
- 60-item page feeds every section → above first page invisible until Load more.
- Load more visible iff `hasNextPage`. Pressing fetches; UI ⊥ reflect (caps mask growth).
- Sort (alpha/runtime/status) = client-only over loaded pages → wrong above 60.
- Mood cluster `count` = loaded items in mood (partial). "See all" = `onPeek(items[0])` (broken).

`counts.total > 60` users: most items unreachable.

## Goal

- Flat "All Items" view = every watchlist item, paginated, sortable, filterable.
- Per-section endpoints → each section paginates independent. Section growth ⊥ tied to one shared list.
- "See all" mood = real navigation to paginated mood-filtered grid.
- Server owns sort + classification + mood derivation. Authoritative across whole active set.
- Tonight = server-scored top-N. Deterministic.
- Above-fold blocks paint w/ route loader. Below-fold streams via Suspense.

## Non-goals

- Plugin writes (still v2 per prior doc).
- Mood persistence / user-curated clusters.
- Per-user mood weight learning.
- WebSocket / SSE invalidation.
- New filter chips beyond ready / awaiting / upcoming.
- Server-derived `inProgress` count (host progress-aggregator pending; placeholder = 0 retained from prior doc).

## Architecture

```
                       ┌──────────────── route loader ────────────────┐
[GET /watchlist]  ─►   │  GET /api/watchlist/counts                    │
                       │  ensureQueryData → cache hydrate              │
                       └──┬────────────────────────────────────────────┘
                          ▼
                       [paint above fold: <Header counts/>]
                          ▼
                       [<Suspense> TonightPick → /sections/tonight ]   ← above visual fold
                          ▼
                       [below fold sections each behind <Suspense>]
                          │
   ┌──────────────┬───────┴──────┬──────────────┬──────────────┬──────────────┐
   ▼              ▼              ▼              ▼              ▼              ▼
[ReadyRow]    [MoodMosaic]   [ComingUp]     [Awaiting]    [RecentlyAdded]  [AllItems]
   │              │              │              │              │              │
   │              │              │              │              │              │
 /items?      /moods +       /items?        /items?       /sections/      /items?
 bucket=      /moods/:id/    bucket=        bucket=       recently         sort=<>
 ready        items          upcoming       awaiting

  [click bucket chip] → navigate /watchlist/all?bucket=<x>
  [click "See all" in MoodCluster] → navigate /watchlist/moods/:moodId
```

Single internal table (`watchlist_items`) unchanged. Read paths multiplied; write paths (add / remove / seed / sync) unchanged.

## §I.api — endpoints

REST-split. One URI per resource. Replaces prior `/api/watchlist?filter=` shape.

```
GET /api/watchlist/items
  Query: cursor?, limit?, sort?, bucket?, mood?
    sort ∈ {recent, alpha, runtime, status}  default = "recent"
    bucket ∈ {ready, awaiting, upcoming}     omit = ∀ buckets ∪ "unknown"
    mood ∈ MOOD_IDS                          intersect w/ bucket if both
  → { items: WatchlistItem[], cursor: string|null, partial: boolean }

GET /api/watchlist/sections/tonight
  Query: ⊥
  → { items: WatchlistItem[], partial: boolean }
    items[0] = hero; items[1..4] = alternates by score. ⊥ cursor.

GET /api/watchlist/sections/recently
  Query: limit?  (default 5, max 20)
  → { items: WatchlistItem[], partial: boolean }
    addedAt DESC. ⊥ cursor.

GET /api/watchlist/moods
  Query: ⊥
  → { clusters: MoodSummaryCluster[] }
    MoodSummaryCluster = { moodId: MoodId, count: number }
    Counts = authoritative across active set. Cluster filtered out when count < MIN_CLUSTER_SIZE (=3).
    Client maps moodId → label/note message keys via local MOOD_REGISTRY (no label in payload).

GET /api/watchlist/moods/:moodId/items
  Query: cursor?, limit?  (default 60, max 200)
  → { items: WatchlistItem[], cursor: string|null, partial: boolean }
    Paginated. moodId ∈ MOOD_IDS or 400.

GET /api/watchlist/counts                  // unchanged
  → { ready, inProgress, awaiting, upcoming, total }

POST   /api/watchlist                      // unchanged
DELETE /api/watchlist/:tmdbId/:mediaType   // unchanged
```

**Validation (zod, per route):**
- `/items` `sort` enum, `bucket` enum optional, `mood` enum optional, `limit ∈ [1, 200]`, `cursor` opaque string.
- `/sections/tonight` ⊥ accept query params other than common envelope. Reject body.
- `/sections/recently` `limit ∈ [1, 20]`.
- `/moods/:moodId/items` reject unknown moodId (400).
- Common: 400 envelope `{ error: { code, message } }`.

**Drop `?filter=`** from `/api/watchlist` legacy shape (rev-3 doc) — pre-stable per CON-001 prior doc. Migrate single internal caller (`watchlist-content.tsx` filtered grid) to `/items?bucket=`.

## §S — Server module additions

```
apps/server/src/watchlist/
  service.ts        + listItems(ctx, opts)
                    + getRecentlyAdded(ctx, limit)
                    + getTonightSection(ctx)
                    + getMoodSummary(ctx)
                    + listMoodItems(ctx, moodId, opts)
                    [getCounts, addItem, removeItem, seedFromPlugins, syncFromPlugins, listAvailable] unchanged

  repo.ts           + listPage variants per sort
                    + listMoodCandidates(userId, moodId, { cursor, limit })

  classify.ts       unchanged

  moods/            NEW sub-folder
    registry.ts       MOOD_IDS tuple (server-side; client owns label/note message keys)
    derive.ts         derive(row, metadata) → MoodId[]   // pure
    cluster.ts        getSummary(userId, ctx) → MoodSummaryCluster[]
                      [cached 30s/user, invalidated on mutation event]

  tonight/          NEW sub-folder
    score.ts          score(item, prior) → number
    pick.ts           pick(candidates) → { hero, alternates[≤4] }
                      [cached 5min/user, invalidated on mutation event]

  jobs/
    on-watchlist-mutation.ts  NEW listener — on("watchlist.itemAdded"|"watchlist.itemRemoved")
                              → invalidate(tonight, mood-summary) caches.
                              Registered via registerJobs() (notifications-pattern).
```

### S.1 listItems pseudocode

```
listItems(ctx, { cursor?, limit=60, sort="recent", bucket?, mood? }) →
  if sort === "recent":
    return paginateKeyset(ctx, { cursor, limit, bucket, mood })
  else:
    return paginateOffsetSnapshot(ctx, { cursor, limit, sort, bucket, mood })

// Reusable helper, also used by listMoodItems.
paginateWithOvershoot(fetchFn, classifyFn, { cursor, limit }) →
  scanCursor = cursor
  for hop in 0..MAX_EMPTY_HOPS:
    rows = fetchFn({ cursor: scanCursor, limit: limit * overshoot })
    if rows.empty: return { items: [], cursor: null }
    matched = rows.filter(classifyFn)
    if matched.length > 0:
      slice = matched.slice(0, limit)
      nextCursor = computeNextCursor(slice, rows, exhausted)
      return { items: slice, cursor: nextCursor }
    scanCursor = encodeCursor(rows.last)
  return { items: [], cursor: encodeCursor(rows.last) }
```

**Sort handling:**
- `recent` → keyset (addedAt DESC, id DESC). Existing index `(user_id, state, added_at)`. **Strict-stable** across page mutations.
- `alpha` / `runtime` / `status` → small-N offset-snapshot sort. Fetch all active rows, join catalog metadata (already batched + cached), sort in handler, slice by `(offset, limit)`. Cursor = opaque offset token. Active set ≤ ~1000 typical; meta batch already used by `/counts`. **Best-effort stability** — concurrent add/remove between pages can skip / duplicate at the boundary; documented in V.WL1.
- ⊥ new `title_norm` column. ⊥ migration backfill. Title normalization (lowercase, NFD) happens in-handler over catalog title.

**Bucket pre-filter:** existing `previewForClassify` reused. Drops non-matching rows before enrich.

**Mood filter:** intersects `derive(row, meta)` containing `moodId`. Requires metadata batch up front (cheap; reused).

**"unknown" bucket surfacing:** `bucket` omitted → ⊥ pre-classify drop → "unknown" rows included. Fixes invisibility.

### S.2 Tonight pseudocode

```
score(item, prior?) →
    + 100  if status === "in-progress"           // continue-watching wins
    + 80   if status === "available" && hasAnyServerCopy
    + 20   if 90 ≤ runtimeMin ≤ 130             // sweet-spot runtime
    - 10   if runtimeMin < 60
    + 15   if addedAt within 7d
    - diversity(item, prior) * 5                 // anti-repeat across alternates
    - 1000 if bucket ∈ {awaiting, upcoming, unknown}

pick(candidates):
    sorted = sortDesc(candidates, score)
    hero = sorted[0]
    alts = sorted.slice(1).filter(noRepeatGenres(hero)).slice(0, 4)
    return { items: [hero, ...alts], partial: false }

getTonightSection(ctx):
    rows = repo.list(userId, { state: "active" })
    rows = classify.preFilter(rows, "ready", userId, ctx)     // ready + in-progress only
    enriched = await enrich(rows, ctx)
    return pick(enriched.items)
```

Cache: `tonight:<userId>` 5 min TTL. Invalidate on watchlist mutation.

### S.3 Mood pseudocode

```
MOOD_RULES (registry.ts) ←
  cozy       : genres ∩ {family|romance|comedy} ∧ runtimeMin < 100 ∧ year ≥ 1990
  epic       : genres ∩ {adventure|fantasy|war}  ∨ runtimeMin ≥ 150
  cerebral   : genres ∩ {documentary|mystery}    ∨ genres ⊇ {drama, arthouse-tagSet}
  dark       : genres ∩ {horror|thriller|crime}
  laugh      : genres ∩ {comedy|animation-comedy}
  throwback  : year < 1990
  quick      : mediaType=movie ∧ runtimeMin ≤ 95
  binge      : mediaType=tv    ∧ episodeCount ≥ 6

derive(row, meta) → MoodId[]:
  out = []
  ∀ moodId, rule ∈ MOOD_RULES:
    if rule.matches(meta): out.push(moodId)
  return out

getMoodSummary(ctx):
  cached = cache.get(`mood-summary:${userId}`)
  if cached && !mutationDirty: return cached
  rows = repo.listAllActive(userId)
  metaMap = ctx.catalogService.getMetadataBatch(rows.keys)
  tally = Map<MoodId, number>
  ∀ row ∈ rows:
    tags = derive(row, metaMap[row.compositeId])
    ∀ t ∈ tags: tally[t]++
  clusters = MOOD_IDS.map(id => ({ moodId: id, count: tally[id] ?? 0 })).filter(c => c.count >= MIN_CLUSTER_SIZE)
  cache.set(`mood-summary:${userId}`, clusters, ttl=30s)
  return { clusters }

listMoodItems(ctx, moodId, { cursor, limit=60 }):
  // Reuses paginateWithOvershoot (§S.1).
  return paginateWithOvershoot(
    fetchFn:    ({cursor, limit}) => repo.listPage(userId, { cursor, limit, state: "active" }),
    classifyFn: row => derive(row, metaMap[row.compositeId]).includes(moodId),
    { cursor, limit }
  )
```

Mood derivation pure → testable. No artwork during `getMoodSummary`. Counts authoritative. `MIN_CLUSTER_SIZE=3` enforced on `getMoodSummary` output only — `/moods/:moodId/items` always returns matching rows even if < 3 (consistent with explicit drill-down request).

### S.4 Caching + invalidation

| Cache key | TTL | Invalidate on |
|---|---|---|
| `tonight:<userId>` | 5 min | watchlist.itemAdded, watchlist.itemRemoved |
| `mood-summary:<userId>` | 30 s | watchlist.itemAdded, watchlist.itemRemoved |
| availability-cache (existing) | 30 s | — |

**Listener registration:** new file `watchlist/jobs/on-watchlist-mutation.ts` mirrors notifications-pattern (`notifications/jobs/on-*.ts`). Exports a `register()` function called from `watchlist/index.ts::registerJobs()`. `registerJobs()` invoked once at server bootstrap (`apps/server/src/index.ts`) — single registration site → ⊥ test-import duplicate subscriptions. Pattern:

```
register():
  on("watchlist.itemAdded",   watchlistItemAddedSchema,   ({userId}) => invalidate(userId))
  on("watchlist.itemRemoved", watchlistItemRemovedSchema, ({userId}) => invalidate(userId))

invalidate(userId):
  cache.delete(`tonight:${userId}`)
  cache.delete(`mood-summary:${userId}`)
```

## §C — Client architecture

### C.1 Routes (TanStack)

```
/_authenticated/_app/watchlist.tsx              loader: counts only
                                                Tonight = first <Suspense> child (above visual fold)
/_authenticated/_app/watchlist.all.tsx          loader: counts only
                                                search: { bucket?, sort?, mood? }
                                                Items grid = <Suspense> child
/_authenticated/_app/watchlist.moods.$moodId.tsx loader: counts only
                                                Items grid = <Suspense> child
```

Rationale: loader failures bubble to route `errorComponent`. Keeping loader to `/counts` only means a section-fetch failure renders that section's local ErrorBoundary fallback instead of the whole route. `/counts` is the lightest call (no artwork, no enrich) → cheapest blocker.

### C.2 Hook map

| Hook | Endpoint | Kind |
|---|---|---|
| `useCounts` | `/counts` | `useSuspenseQuery` |
| `useTonight` | `/sections/tonight` | `useSuspenseQuery` |
| `useReadyRow` | `/items?bucket=ready&sort=status&limit=20` | `useSuspenseInfiniteQuery` |
| `useMoods` | `/moods` | `useSuspenseQuery` |
| `useMoodCluster(id)` | `/moods/:id/items?limit=3` (preview cap; "See all" route uses default=60) | `useSuspenseInfiniteQuery` |
| `useComingUp` | `/items?bucket=upcoming` | `useSuspenseInfiniteQuery` |
| `useAwaiting` | `/items?bucket=awaiting` | `useSuspenseInfiniteQuery` |
| `useRecentlyAdded` | `/sections/recently?limit=5` | `useSuspenseQuery` |
| `useAllItems({sort, bucket, mood})` | `/items?...` | `useSuspenseInfiniteQuery` |

Drop existing `useWatchlistItems` (mega-hook). Mutations untouched.

### C.3 Query keys

```
watchlistKeys = {
  root: ["watchlist"] as const,
  counts: () => [...root, "counts"] as const,
  tonight: () => [...root, "section", "tonight"] as const,
  recently: () => [...root, "section", "recently"] as const,
  moods: () => [...root, "moods"] as const,
  moodItems: (id) => [...root, "moods", id, "items"] as const,
  items: (params) => [...root, "items", params] as const,
}
```

Mutation invalidator: `qc.invalidateQueries({ queryKey: watchlistKeys.root })` — clears every section in one shot. Single source.

### C.4 Component layout

```
features/watchlist/
  components/
    sections/                          ← single-file sections sit directly here
      tonight-pick.tsx
      ready-row.tsx
      coming-up.tsx
      awaiting.tsx
      recently-added.tsx
      mood-mosaic/                     ← folder only when multi-file
        index.tsx
        mood-cluster.tsx
      all-items/                       ← folder only when multi-file
        index.tsx                       ← NEW; flat virtualized grid
        sort-select.tsx
        bucket-chips.tsx
    watchlist-page.tsx                  ← curated route page
    watchlist-all-page.tsx              ← NEW; flat route page
    watchlist-mood-page.tsx             ← NEW; per-mood route page
    watchlist-header.tsx                ← shared; mode prop
    watchlist-card.tsx                  ← unchanged
    watchlist-skeleton.tsx              ← unchanged
    watchlist-error-fallback.tsx        ← unchanged
  hooks/
    use-counts.ts
    use-tonight.ts
    use-ready-row.ts
    use-moods.ts
    use-mood-cluster.ts
    use-coming-up.ts
    use-awaiting.ts
    use-recently-added.ts
    use-all-items.ts
    use-add-to-watchlist.ts             ← unchanged
    use-remove-from-watchlist.ts        ← unchanged
    use-is-in-watchlist.ts              ← updated: read from cached items via predicate over root key
    use-toggle-watchlist.ts             ← unchanged
  lib/
    classify.ts                         ← kept (display niceties: totalRuntimeMinutes, splitRuntime)
    derive-moods.ts                     ← DELETED (server owns derivation)
    mood-registry.ts                    ← NEW; client map: MoodId → { labelKey, noteKey }
    format.ts                           ← unchanged
    types.ts                            ← updated: drop local mood types
    fetchers.ts                         ← per-endpoint fetchers
    query-keys.ts                       ← updated
  __tests__/
    derive-moods.test.ts               ← DELETED w/ lib/derive-moods.ts in Phase 4
  __fixtures__/
```

Single-file sections live flat in `components/sections/` per feedback memory #17 (⊥ unnecessary nesting). Multi-file sections (`mood-mosaic`, `all-items`) get a folder. ⊥ subdir barrels (V57).

### C.5 Header behavior

`WatchlistHeader` factored to take `mode: "curated" | "flat"`. `mode` enum exhaustive (TS-enforced switch, V.WL6):
- `curated` (`/watchlist`): pip totals + title + total runtime. ⊥ bucket chips, ⊥ sort dropdown.
- `flat` (`/watchlist/all`): pip totals + bucket chips + sort dropdown. Chips push to `?bucket=<x>` via `navigate`. Sort same.

Top of curated route adds "View all" link → `/watchlist/all`. Mood "See all" → `/watchlist/moods/:id`.

### C.6 In-progress chip + count

`WatchlistCounts.inProgress` field **stays in wire** (placeholder 0 until host progress aggregator lands — prior doc constraint). The *header chip* for "in-progress" is **removed** from `WatchlistHeader` (rendered nothing useful at 0). `in-progress` is **not** a value in `WATCHLIST_BUCKETS` (server enum) — it remains a **client-only refinement layered on `bucket=ready`** via `classifyStatus(item)` reading `item.progress`. Today's chip behavior `filter="in-progress"` → wire filter `ready` becomes navigation `/watchlist/all?bucket=ready` w/o in-progress sub-chip; client overlay on individual cards still indicates resume state.

Future work: when server aggregator lands, add `inProgress` as a true bucket — separate amendment.

## §W — Wire types

`packages/shared/src/watchlist/`:

```
enums.ts:
  WATCHLIST_SORTS   = ["recent", "alpha", "runtime", "status"]              as const
  WATCHLIST_BUCKETS = ["ready", "awaiting", "upcoming"]                     as const
  MOOD_IDS          = ["cozy", "epic", "cerebral", "dark",
                       "laugh", "throwback", "quick", "binge"]              as const
  MIN_CLUSTER_SIZE  = 3 as const

types.ts:
  WatchlistSort       = typeof WATCHLIST_SORTS[number]
  WatchlistBucket     = typeof WATCHLIST_BUCKETS[number]
  MoodId              = typeof MOOD_IDS[number]
  MoodSummaryCluster  = { moodId: MoodId; count: number }
  WatchlistMoodSummary= { clusters: MoodSummaryCluster[] }
  TonightSection      = { items: WatchlistItem[]; partial: boolean }
  RecentlySection     = TonightSection
  // WatchlistResponse + WatchlistItem unchanged

schemas.ts:
  itemsQuerySchema = z.object({
    cursor: z.string().optional(),
    limit:  z.coerce.number().int().positive().max(200).optional(),
    sort:   z.enum(WATCHLIST_SORTS).optional(),
    bucket: z.enum(WATCHLIST_BUCKETS).optional(),
    mood:   z.enum(MOOD_IDS).optional(),
  })
  recentlyQuerySchema  = z.object({ limit: z.coerce.number().int().min(1).max(20).optional() })
  moodItemsQuerySchema = z.object({ cursor: z.string().optional(),
                                    limit:  z.coerce.number().int().positive().max(200).optional() })
  moodParamSchema      = z.object({ moodId: z.enum(MOOD_IDS) })
```

Rename `WatchlistListFilter` → `WatchlistBucket` (semantic clarity). Pre-stable per CON-001 prior doc. **Pre-rename guard** lives in §M Phase 0 (grep released packages first).

## §V — Invariants (additions)

- **V.WL1.** `/api/watchlist/items` returns rows in sort order matching `sort` param. Cursor opaque (encoding remains server-private; clients ⊥ assume offset structure even though `sort=alpha|runtime|status` use offset-snapshot internally). `sort=recent` cursor strictly stable across page mutations (keyset). `sort=alpha|runtime|status` best-effort stability; concurrent add/remove between pages may skip / dupe at the page boundary by 1 row. Server ⊥ silently switch sort. Drift = test fail (`service.test.ts`).
- **V.WL2.** `/api/watchlist/items` w/o `bucket` includes "unknown"-classified rows. Header `counts.total` ⇔ count of rows returned across full pagination ∀ default sort. Drift = visibility regression.
- **V.WL3.** Mood derivation is a pure function of `(row, metadata)`. ⊥ I/O, ⊥ random, ⊥ time. Test = property-based determinism.
- **V.WL4.** Tonight scoring deterministic given same `(candidates, scoring weights)`. ⊥ ties broken by id only. Cache invalidation always after watchlist mutation event handled.
- **V.WL5.** Mutation invalidator clears `watchlistKeys.root` exactly once per mutation success. Per-section keys nested under root. New section = new sub-key under root, ⊥ separate root.
- **V.WL6.** `WatchlistHeader` `mode` prop is exhaustive. New mode = compile-time enum extension. ⊥ string drift.
- **V.WL7.** "See all" links on mood clusters resolve to `/watchlist/moods/:moodId` w/ moodId ∈ `MOOD_IDS`. ⊥ peek-modal fallback. Bad moodId = 400 → ErrorBoundary fallback.

## §M — Migration plan

Phased; each phase shippable on its own. Pre-stable.

**Phase 0 — Pre-rename guard.**
- `grep -rn "WatchlistListFilter\|WATCHLIST_LIST_FILTERS" packages/plugins packages/plugin-sdk`. Released-package hit → escalate. Workspace-only → proceed.

**Phase 1 — Wire types + server endpoints.**
- Add enums + types + schemas in shared package.
- Add new service functions (listItems, getTonightSection, getRecentlyAdded, getMoodSummary, listMoodItems).
- Add new routes in `api/procedures/watchlist.ts`.
- Add `moods/` + `tonight/` sub-folders w/ pure logic + tests.
- Add `jobs/on-watchlist-mutation.ts` + wire `registerJobs()` from `index.ts`.
- Existing `getItems(opts.filter)` path kept temporarily, marked deprecated in service.

**Phase 2 — Client routes + hooks.**
- Add `/watchlist/all` route + page.
- Add `/watchlist/moods/:moodId` route + page.
- Refactor `WatchlistContent` → split per-section components consuming per-section hooks.
- Add route loaders for above-fold.
- Per-section Suspense + ErrorBoundary.

**Phase 3 — Header refactor + nav wiring.**
- Header `mode` prop. Bucket chips become nav not state.
- "View all" + "See all" links wired.

**Phase 4 — Cleanup.**
- Delete `apps/client/src/features/watchlist/lib/derive-moods.ts`.
- Delete `apps/client/src/features/watchlist/__tests__/derive-moods.test.ts`.
- Delete `useWatchlistItems`.
- Delete legacy `getItems(opts.filter)` path. Drop `WATCHLIST_LIST_DEFAULT_LIMIT` / `WATCHLIST_LIST_MAX_LIMIT` consts if unreferenced (else move to `/items` constants).
- Rename `WatchlistListFilter` → `WatchlistBucket` across remaining refs.

**Phase 5 — Changeset.**
Single user-facing changeset under `@ent-mcp/client`:
- `@ent-mcp/client`: minor — Watchlist page now lists every item in a sortable flat view and shows a paginated per-mood listing when "See all" is selected.

`@ent-mcp/server` not in released-set externally per CLAUDE.md (private internal); changes covered by empty-frontmatter changeset:
```
---
---
```

## §T — Tests

| File | Coverage |
|---|---|
| `watchlist/__tests__/service.test.ts` extension | `listItems` sort variants, `bucket` omit surfaces unknown, mood intersect, cursor stability |
| `watchlist/tonight/__tests__/score.test.ts` NEW | scoring weight ordering, runtime sweet-spot, in-progress wins, diversity penalty, deterministic ties |
| `watchlist/tonight/__tests__/pick.test.ts` NEW | hero + ≤4 alternates, empty candidates returns empty, awaiting/upcoming penalized out |
| `watchlist/moods/__tests__/derive.test.ts` NEW | each MOOD_RULE triggers expected tags, multi-tag overlap, empty meta returns ∅ |
| `watchlist/moods/__tests__/cluster.test.ts` NEW | summary tally accurate, empty cluster omitted, cache hit on second call within TTL |
| `api/__tests__/watchlist-routes.test.ts` extension | all 5 new endpoints: validation, 200 happy path, 400 unknown mood, 400 invalid sort |
| `client features/watchlist/__tests__/use-all-items.test.ts` NEW | suspense load, sort param round-trip, infinite scroll cursor handoff |
| `client features/watchlist/__tests__/use-moods.test.ts` NEW | summary + cluster items hook composition |
| `client features/watchlist/__tests__/header.test.ts` NEW | mode prop branches; exhaustive switch (compile-time guard for V.WL6); bucket chip click navigates |
| `client features/watchlist/__tests__/use-add-to-watchlist.test.ts` EXTEND | assert `invalidateQueries({queryKey: watchlistKeys.root})` called exactly once on settle (V.WL5) |
| `client features/watchlist/__tests__/watchlist-mood-page.test.tsx` NEW | 400 on unknown moodId → ErrorBoundary fallback render (V.WL7) |

Cover intent per CLAUDE.md rule 9: each test pins the WHY (e.g., "all-items must surface unknown bucket — V.WL2").

## §R — Risks

- **R1.** Cache invalidation race. Watchlist mutation emits event; tonight/mood-summary cache listens via `on()`. If listener registration occurs after first mutation, stale data returned. Mitigation: register listeners at module init (server bootstrap), assert presence in `service.test.ts`.
- **R2.** Alpha / runtime / status sort cost. Each request sweeps full active set (≤ ~1000 typical) + joins catalog metadata batch. No new index, no migration. Server cost ≈ same as `/counts` already pays. Mitigation: rely on existing `catalogService.getMetadataBatch` cache; benchmark at 2× typical active-set size before ship.
- **R3.** Tonight scoring weights cosmetic but visible. Iteration risk. Mitigation: weights centralized in `score.ts`, snapshot test on a stable fixture so changes are intentional.
- **R4.** Mood heuristics English-locale-bound (matches genre name strings via `derive`). Prior doc R1 still applies — same caveat carries over.
- **R5.** Below-fold fetch count: 5 parallel queries on first paint. Bandwidth ≤ 1 enriched page each. Acceptable; HTTP/2 multiplex. Mitigation: enrich pipeline already memoizes within-request; no extra dedupe needed.

## §O — Open questions

- **O1.** Should bucket chips on `/watchlist/all` also influence `/watchlist` curated layout? Default: no — curated is curated. Chips only on flat route.
- **O2.** Sort persistence: URL state only or also user pref? Default: URL state only (matches existing convention, prior doc non-goal).
- **O3.** Tonight "diversity" measured by genre overlap or mood overlap? Default: genre (simpler). Promote to mood if user feedback warrants.

## §N — Notes / unresolved

- Old design (rev 3 of 2026-05-19) called out `inProgress` placeholder count = 0. Same here. Surface once host progress aggregator ships.
- Server enrich budget per section documented in §S. Watch `/moods` and `/counts` — both sweep active set; combined sweep cost should not surprise. Both meta-only, no artwork.

---

End design.

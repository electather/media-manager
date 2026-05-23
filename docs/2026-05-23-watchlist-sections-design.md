# Watchlist Sections — REST-split + Flat All-Items

**Status:** design (rev 3)
**Date:** 2026-05-23 (rev 1: 2026-05-23, rev 2: 2026-05-23, rev 3: 2026-05-23)
**Author:** Omid Astaraki
**Supersedes (partial):** [2026-05-19-watchlist-backend-design.md](./2026-05-19-watchlist-backend-design.md) §I.api + client layout. Storage, seed, sync, events unchanged.
**Deps:** [2026-05-19-watchlist-backend-design.md](./2026-05-19-watchlist-backend-design.md), [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md), [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), `frontend-feature-architecture` skill, `backend-feature-architecture` skill.

Caveman ultra. Pseudo = shape only, ⊥ literal.

## Revision history

- **rev 5 (2026-05-23)** — Curated-page card reuse pass + mood pagination fix.
  - `TonightPick` simplified: section head + wide `WatchlistCard forceAspect="16/9"` hero + alternates aside. "Why" caption and shuffle button removed. Aside rendered with the new shared `MediaRow` family (numeric position prefix + thumb + title + meta). Hero identity carried by the card's clear-logo overlay.
  - `WatchlistCard` 16:9 mode now always renders `MediaCardClearLogo` with `text={item.title}` fallback when no `clearLogo` URL. Title slot below the frame suppressed in 16:9 to avoid duplicate identity (year-only subtitle dropped along with it). 2:3 mode unchanged.
  - `MoodCluster` hero swapped to `WatchlistCard forceAspect="16/9"` (wide). Secondaries now compose the new shared `MediaRow` family (`@/shared/components/media-row/`: `Root | Thumb | Body | Title | Meta`) so the row primitive is reusable beyond the watchlist.
  - `MoodMosaic` caps the grid at `MAX_CLUSTERS = 3` (`clusters.slice(0, 3)`) so the curated page always renders a balanced three-card row. Mood summary endpoint still returns the full set; the cap is purely UI density.
  - **Server `listMoodItems` accumulator + scan-budget fix (S.3)**. Two-step regression:
    1. The hop loop previously broke out as soon as ONE matching item surfaced in a window, which truncated sparse moods to a single result. The loop now accumulates `(items, sources)` across windows.
    2. The first fix kept the original `MAX_EMPTY_HOPS = 2` cap as the total scan budget, so users with 40+ rows and moods that fire only once per ~12 rows still saw 1–2 items per preview. The cap is now `MAX_MOOD_HOPS = 20` for the safety ceiling, and the `MAX_EMPTY_HOPS` counter only fires when consecutive windows yield **zero** matches. Underfilled hops (matched some, but not enough to fill the page) reset the empty streak so the request keeps scanning while it's making progress.
    Cursor still encodes the last *returned* source (or null when the scan exhausts cleanly). Two regression tests in `apps/server/src/watchlist/__tests__/service.test.ts`.
  - Unused paraglide keys removed: `watchlist_tonight_why`, `watchlist_tonight_default_reason`, `watchlist_tonight_shuffle` (en + fa). `watchlist_tonight_alternates_kicker` retained for the aside header.
  - **Rate-limit + retry fix.** Curated page issues ~9 reads in a single paint (counts + tonight + recently + moods summary + 3 mood previews + bucket-driven sections). The previous `watchlistReadLimiter` burst of 10 starved the very first paint when combined with React refresh. Burst raised to 30 (refill unchanged at 10/min) so a cold page-load plus a quick refresh fits comfortably; sustained polling still throttles.
  - **`WatchlistErrorFallback` retry now resets the cached queries with section-scoped targeting.** A plain `resetErrorBoundary()` left the failed `useSuspenseQuery` entry in the cache, so re-mounting the Suspense child re-threw the same error and "Retry" looked like a no-op. The fallback now accepts an optional `queryKey` prop and calls `queryClient.resetQueries({ queryKey })` before resetting the boundary. The curated page's `SectionFrame` passes the specific section key (`tonight()`, `items({ bucket })`, `moods()`, `recently()`); the flat + mood pages pass their primary section key (`items({ sort, bucket })`, `moodItems(moodId)`). Retry now refetches just the failed section instead of resuspending the entire curated page. Root-key fallback preserved as a safety net. Regression tests in `__tests__/watchlist-error-fallback.test.tsx`.
- **rev 4 (2026-05-23)** — Mood detail header gets first-class identity + breadcrumb.
  - `WatchlistHeader` is now route-aware. On `/watchlist/moods/:moodId` it replaces the chip strip with a `Breadcrumb` (`Watchlist › <mood>`) using the shared `@/shared/ui/breadcrumb` family, promotes the mood label to the page H1 alongside the cluster count via `SectionHeadCount`, and renders the mood note as a normal-case subtitle (`<p>` muted, not eyebrow). Chip strip + sort dropdown hidden on this route — neither axis composes with a mood-scoped grid (§C.5).
  - `MoodCount` reads `useMoods()` inside a nested `Suspense fallback={null}` so the rest of the header paints synchronously on cold loads.
  - `WatchlistMoodPage` drops its in-body `SectionHead`; identity now lives in the header (§C.4, §C.5).
  - V.WL8 amended: layout-owned header has two render modes — default (chip strip + conditional sort) and mood detail (breadcrumb + mood label H1 + count + subtitle).
  - Cross-axis composition (mood × bucket) intentionally **not** added; parked as a follow-up if mood drill-down should compose with buckets.
- **rev 3 (2026-05-23)** — Address post-rev-2 design feedback.
  - **Header always shows chip strip + sort dropdown** across the route family. `All` chip → curated layout (`/watchlist` index). Other chips → flat vertical grid sub-routes.
  - **Routes split into sub-routes per bucket** sharing a parent layout (`watchlist.tsx` = `<Outlet/>` + header + peek modal). New children: `watchlist.index.tsx` (curated/All), `watchlist.ready.tsx`, `watchlist.in-progress.tsx`, `watchlist.awaiting.tsx`, `watchlist.upcoming.tsx`. `watchlist.all.tsx` deleted (§C.1).
  - **`WATCHLIST_BUCKETS` widened to 4 values** — adds `"in-progress"` (§W). Pre-stable break; no compat shim.
  - **Server progress signal end-to-end.** `enrich` pulls `getContinueWatchingFeed` once per call, joins by composite id, populates `WatchlistItem.progress`. `classifyBucket` returns `"in-progress"` when row has an active position. `getCounts` emits real `inProgress` (§S, §C.6).
  - **`/counts` cost grows** — was meta+status+servers only, now adds one continue-watching aggregate per call (cached at 30s). Tracked as RISK-008 + follow-up issue.
  - **Sort persistence resolved O2 → URL only** (§C.5).
  - Sort dropdown hidden on `/watchlist` (curated/All); rendered on flat sub-routes only (§C.5).
  - V.WL6 header `mode` exhaustiveness invariant **retired** — chip+sort strip now layout-owned, header takes no mode prop. Replaced by V.WL8 (route-family layout).
  - O1 resolved: chip on curated route navigates to flat sub-route — no per-chip behavior split.
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
- New filter chips beyond ready / in-progress / awaiting / upcoming.
- Host progress-aggregator changes — relies on existing `continueWatching@v1` aggregate (see §S.5).

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
    sort ∈ {recent, alpha, runtime, status}            default = "recent"
    bucket ∈ {ready, in-progress, awaiting, upcoming}  omit = ∀ buckets ∪ "unknown"
    mood ∈ MOOD_IDS                                    intersect w/ bucket if both
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

### S.5 Progress signal (in-progress bucket)

```
enrich(rows, ctx):
  // existing: statuses, metadata, server probes
  cwFeed = ctx.mediaService.getContinueWatchingFeed({ deadlineMs })   // request-memo'd
  progressMap = Map<compositeId, { watched: number, total: number }>
  ∀ entry ∈ cwFeed.items:
    compositeId = `${entry.item.type}:${extractTmdbId(entry)}`
    if entry.progressMs > 0 && entry.item.durationSec > 0:
      progressMap.set(compositeId, { watched: entry.progressMs/1000, total: entry.item.durationSec })
  ∀ row ∈ rows:
    item.progress = progressMap.get(item.id)   // undef when no active position
```

`classify.previewForClassify` receives progress map alongside meta/status/servers. New bucket precedence:

```
classifyBucket(item):
  if item.progress && item.progress.watched < item.progress.total: return "in-progress"
  if item.availability.hasAnyServerCopy:                           return "ready"
  if STATUS_MAP[item.status]:                                      return STATUS_MAP[item.status]
  if facets.releaseDate || isInfoOnly:                             return "upcoming"
  return "unknown"
```

`getCounts` walks rows once with `(meta, status, servers, progress)` → 4-bucket tally. `partial=true` when CW probe rejects; `inProgress` falls back to `0` rather than blocking the response.

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
/_authenticated/_app/watchlist.tsx               LAYOUT — loader: counts. Renders header + <Outlet/> + peek modal.
/_authenticated/_app/watchlist.index.tsx         /watchlist             curated sections (All)
/_authenticated/_app/watchlist.ready.tsx         /watchlist/ready       flat grid, bucket=ready
/_authenticated/_app/watchlist.in-progress.tsx   /watchlist/in-progress flat grid, bucket=in-progress
/_authenticated/_app/watchlist.awaiting.tsx      /watchlist/awaiting    flat grid, bucket=awaiting
/_authenticated/_app/watchlist.upcoming.tsx      /watchlist/upcoming    flat grid, bucket=upcoming
/_authenticated/_app/watchlist.moods.$moodId.tsx /watchlist/moods/:id   paginated mood listing
```

Layout-route owns counts loader + header. Child routes own their own `<Suspense>` content. URL search params per leaf: flat routes accept `{ sort?, peek? }`; mood route accepts `{ peek? }`; curated index accepts `{ peek? }`. **Deleted:** `watchlist.all.tsx`. **Pre-stable break:** old `/watchlist/all` URL stops resolving (no redirect, per CON-001 prior doc).

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

`WatchlistHeader` owned by the layout route. Two render modes:

**Default** (`/watchlist`, `/watchlist/<bucket>`):
- Pip totals + title + total runtime (left).
- Bucket chip strip (center-left): `All | Ready | In progress | Awaiting | Upcoming` — `<Link to="/watchlist[/<bucket>]">`. Active chip = current pathname match.
- Sort dropdown (right): rendered **only when the active route is a flat bucket sub-route**. Hidden on `/watchlist` (curated). Writes `?sort=` search param on its own route.

**Mood detail** (`/watchlist/moods/:moodId`):
- Breadcrumb (top): `Watchlist › <mood label>` using shared `@/shared/ui/breadcrumb`. Root segment links to `/watchlist`; trailing segment = current mood (`BreadcrumbPage`).
- Title row: mood label → `<h1>` via `SectionHeadTitle size="page"`. Cluster count → `SectionHeadCount` inline at baseline (e.g., `Dark 07`). Count reads `useMoods()` inside a nested `Suspense fallback={null}` so the title paints immediately on cold loads.
- Subtitle: mood note as `<p>` muted body text (e.g., `Big runtime, bigger stakes.`). **Not** an eyebrow — uppercase-mono treatment doesn't fit prose copy.
- **Chip strip + sort hidden.** Bucket axis ⊥ compose with mood axis; chips here would either navigate away from the mood (broken UX) or imply cross-axis filtering the server doesn't support yet (rev 4 §Open items).
- Unknown `moodId` → falls back to default header (the page's ErrorBoundary still owns the 400 fallback).

Mood "See all" → `/watchlist/moods/:id`. No more curated `View all items` button — the chip strip subsumes it.

**Persistence:** filter + sort state live in URL only (path segment for bucket, search param for sort). No localStorage. Resolves §O.O2.

### C.6 In-progress chip + count

`WatchlistCounts.inProgress` field populated server-side from a per-row progress probe. `"in-progress"` is a real value in `WATCHLIST_BUCKETS`. Client header chip renders with `counts.inProgress` and links to `/watchlist/in-progress`.

Source of truth: `MediaService.getContinueWatchingFeed()` (existing `continueWatching@v1` aggregate). Joined to active watchlist rows by composite id at enrich time. See §S.5 for the data flow + cache placement.

## §W — Wire types

`packages/shared/src/watchlist/`:

```
enums.ts:
  WATCHLIST_SORTS   = ["recent", "alpha", "runtime", "status"]              as const
  WATCHLIST_BUCKETS = ["ready", "in-progress", "awaiting", "upcoming"]      as const
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
- **V.WL6.** ~~`WatchlistHeader` `mode` prop is exhaustive.~~ **Retired in rev 3.** Replaced by V.WL8.
- **V.WL7.** "See all" links on mood clusters resolve to `/watchlist/moods/:moodId` w/ moodId ∈ `MOOD_IDS`. ⊥ peek-modal fallback. Bad moodId = 400 → ErrorBoundary fallback.
- **V.WL8.** Watchlist layout route owns the header; child routes ⊥ render their own header. Header has two render modes derived from `useLocation` pathname: **default** (chip strip + conditional sort) and **mood detail** (`← All moods` link + mood label H1 + mood note eyebrow, chips + sort hidden). Bucket chip active state derived from pathname — ⊥ duplicated client state. Adding a new bucket = single edit to `WATCHLIST_BUCKETS` enum + one new child route file; header chip strip auto-includes (TS exhaustive `Record<WatchlistBucket, ...>` over labels). Adding a new mood = single entry in `MOOD_IDS` + `MOOD_REGISTRY`; mood header auto-renders.

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
- **R6 (rev 3).** `/counts` cost grew — was meta+status+servers only; now also fans out `continueWatching@v1.getContinueWatching` aggregate per call to populate `inProgress`. Plugin aggregate cost is O(connections), not O(active rows), so wall-clock impact bounded by slowest enabled plugin. Cached in MediaService request memo + per-user 30 s availability cache reuses status. Mitigation: keep CW feed result behind a per-request memo; if profile shows headroom problems, promote to a per-user TTL cache. Follow-up issue tracked.

## §O — Open questions

- **O1.** ~~Bucket chips per-route?~~ **Resolved rev 3.** Chips render in the shared layout header across the whole `/watchlist/*` family. Chip selection navigates between sub-routes.
- **O2.** ~~Sort persistence?~~ **Resolved rev 3.** URL only. No localStorage.
- **O3.** Tonight "diversity" measured by genre overlap or mood overlap? Default: genre (simpler). Promote to mood if user feedback warrants.

## §N — Notes / unresolved

- Old design (rev 3 of 2026-05-19) called out `inProgress` placeholder count = 0. Same here. Surface once host progress aggregator ships.
- Server enrich budget per section documented in §S. Watch `/moods` and `/counts` — both sweep active set; combined sweep cost should not surprise. Both meta-only, no artwork.

---

End design.

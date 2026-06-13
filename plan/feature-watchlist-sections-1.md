---
goal: Implement REST-split watchlist sections, server-side mood derivation, server-side Tonight scoring, and a flat all-items grid view so the watchlist page lists every item regardless of size
version: 1.0
date_created: 2026-05-23
last_updated: 2026-05-23
owner: Omid Astaraki
status: 'Planned'
tags: [feature, backend, frontend, api, refactor]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Replace the single `/api/watchlist?filter=` endpoint with a REST-split section API (`/items`, `/sections/tonight`, `/sections/recently`, `/moods`, `/moods/:moodId/items`). Move mood derivation and Tonight scoring to the server so cluster counts and "See all" navigation are authoritative across the entire active set. Add a flat `/watchlist/all` route backed by `/items` (default sort `recent`, filterable by `bucket` + `mood`) so users with watchlists larger than the first page can browse every item, including "unknown"-bucket items that today drop out of the curated layout. Refactor the client into per-section Suspense boundaries fed by per-section hooks, with the route loader fetching only `/counts` so per-section failures degrade gracefully.

Design spec: [docs/2026-05-23-watchlist-sections-design.md](../docs/2026-05-23-watchlist-sections-design.md).

## 1. Requirements & Constraints

- **REQ-001**: `/api/watchlist/items` returns every active row when called with no `bucket` parameter, including rows whose classifier bucket is `unknown`.
- **REQ-002**: `/api/watchlist/items` supports `sort` ∈ `{recent, alpha, runtime, status}` with `recent` as the default and `recent` using keyset cursors.
- **REQ-003**: `/api/watchlist/items` accepts an optional `mood` parameter that intersects with `bucket` when both are supplied.
- **REQ-004**: `/api/watchlist/sections/tonight` returns `items[0]` as the hero plus up to four alternates scored by `tonight/score.ts`; deterministic given identical inputs.
- **REQ-005**: `/api/watchlist/sections/recently` accepts `limit` ∈ `[1, 20]` (default 5) and returns rows sorted by `addedAt DESC`. No cursor.
- **REQ-006**: `/api/watchlist/moods` returns aggregate cluster counts across the active set, filtering out clusters where `count < MIN_CLUSTER_SIZE` (constant `3`).
- **REQ-007**: `/api/watchlist/moods/:moodId/items` paginates per-mood items with default `limit=60`, max `200`.
- **REQ-008**: `/api/watchlist/counts` continues returning `{ ready, inProgress, awaiting, upcoming, total }` unchanged.
- **REQ-009**: `WatchlistCounts.inProgress` remains in the wire contract as a placeholder (`0` until the host progress aggregator lands). The in-progress filter chip is removed from the client header but `in-progress` is **not** added to `WATCHLIST_BUCKETS`.
- **REQ-010**: Tonight pick cache TTL = 5 min per user, mood-summary cache TTL = 30 s per user. Both invalidated on `watchlist.itemAdded` / `watchlist.itemRemoved` events.
- **REQ-011**: Cache invalidation listeners live in `apps/server/src/watchlist/jobs/on-watchlist-mutation.ts` and register through a `registerJobs()` call from `apps/server/src/index.ts`. **Not** registered inline in `service.ts`.
- **REQ-012**: Mood derivation is a pure function of `(row, metadata)` — no I/O, no randomness, no time-dependent inputs.
- **REQ-013**: Client routes `/watchlist`, `/watchlist/all`, and `/watchlist/moods/:moodId` each have a TanStack Router loader that calls `/counts` only. Section data comes from `useSuspenseQuery` / `useSuspenseInfiniteQuery` inside `<Suspense>` children.
- **REQ-014**: Bucket chips on `/watchlist/all` are navigation (push `?bucket=<x>`), not local state.
- **REQ-015**: Mutation hooks (`useAddToWatchlist`, `useRemoveFromWatchlist`) invalidate `watchlistKeys.root` exactly once per settled mutation; all per-section query keys nest under `["watchlist", ...]`.
- **SEC-001**: All new routes require an authenticated session and follow the existing per-route auth middleware pattern.
- **SEC-002**: Path and query parameters validated via zod (`itemsQuerySchema`, `moodItemsQuerySchema`, `recentlyQuerySchema`, `moodParamSchema`). Unknown `moodId` returns 400.
- **CON-001**: Pre-stable per the prior `2026-05-19` doc. `WatchlistListFilter` is renamed to `WatchlistBucket` with no shim. `?filter=` parameter on `/api/watchlist` is removed.
- **CON-002**: No new `title_norm` column, no migration backfill. `alpha`/`runtime`/`status` sorts use an in-memory offset-snapshot over the joined catalog metadata batch.
- **CON-003**: Released-package guard (Phase 0): grep `packages/plugins/*` and `packages/plugin-sdk/` for `WatchlistListFilter` / `WATCHLIST_LIST_FILTERS` before renaming.
- **CON-004**: Sub-component nesting cap — single-file sections sit flat in `apps/client/src/features/watchlist/components/sections/<name>.tsx`. Only multi-file sections (`mood-mosaic/`, `all-items/`) get a folder.
- **CON-005**: No subdir barrels under `features/watchlist/components/sections/` (V57).
- **CON-006**: Server changeset = empty frontmatter (internal); client changeset = single `@nama/client` minor with end-user language.
- **GUD-001**: Mirror notifications-pattern for listener registration: `<module>/jobs/on-*.ts` exporting `register()`, wired into module-level `registerJobs()`.
- **GUD-002**: Caveman ultra in the design doc; normal prose in code, commits, PR bodies. i18n via paraglide `m.*` for any new translatable copy.
- **GUD-003**: Tests pin invariants (V.WL1–V.WL7) per CLAUDE.md rule 9; each test must encode the WHY.
- **PAT-001**: Reuse `paginateWithOvershoot` helper across `listItems` and `listMoodItems` so the empty-hop logic is implemented once.
- **PAT-002**: Counts endpoint stays separate from list endpoints; do not fold counts into `/items`.
- **PAT-003**: Each section gets its own `<ErrorBoundary><Suspense><Section/></Suspense></ErrorBoundary>` wrapper on the client; section failures stay scoped.

## 2. Implementation Steps

### Implementation Phase 0 — Pre-rename guard

- GOAL-000: Confirm the `WatchlistListFilter` rename is safe before any code change.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Run `grep -rn "WatchlistListFilter\|WATCHLIST_LIST_FILTERS" packages/plugins packages/plugin-sdk apps/server/src/index.ts` and record the output. If any released-package file matches, halt Phase 1 and surface the hit. | | |
| TASK-002 | Confirm workspace-internal callers (`apps/server`, `apps/client`) — list the files that will need an import path update so Phase 1 picks them up. | | |

### Implementation Phase 1 — Shared types + server endpoints

- GOAL-001: Land wire types and the new section endpoints (server-only). Existing `getItems(opts.filter)` path is kept temporarily so client still functions during the rollout.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | Extend `packages/shared/src/watchlist/enums.ts` with `WATCHLIST_SORTS = ["recent", "alpha", "runtime", "status"] as const`, `WATCHLIST_BUCKETS = ["ready", "awaiting", "upcoming"] as const`, `MOOD_IDS = ["cozy", "epic", "cerebral", "dark", "laugh", "throwback", "quick", "binge"] as const`, `MIN_CLUSTER_SIZE = 3 as const`. | | |
| TASK-004 | Extend `packages/shared/src/watchlist/types.ts` with `WatchlistSort`, `WatchlistBucket`, `MoodId`, `MoodSummaryCluster = { moodId: MoodId; count: number }`, `WatchlistMoodSummary = { clusters: MoodSummaryCluster[] }`, `TonightSection = { items: WatchlistItem[]; partial: boolean }`, `RecentlySection = TonightSection`. Rename `WatchlistListFilter` → `WatchlistBucket` and update local re-exports. | | |
| TASK-005 | Extend `packages/shared/src/watchlist/schemas.ts` with `itemsQuerySchema`, `recentlyQuerySchema`, `moodItemsQuerySchema`, `moodParamSchema`. Use `z.coerce.number().int().positive().max(200)` for `limit` on `/items` and `/moods/:id/items`; `min(1).max(20)` for `/sections/recently`. | | |
| TASK-006 | Update `packages/shared/src/watchlist/index.ts` barrel to re-export the new enums, types, and schemas. | | |
| TASK-007 | Create `apps/server/src/watchlist/moods/registry.ts` exporting `MOOD_IDS` mirror (shared import) and a server-only `MOOD_RULES` map keyed by `MoodId` describing the heuristics from design §S.3 (genres + runtime + year + episode-count predicates). | | |
| TASK-008 | Create `apps/server/src/watchlist/moods/derive.ts` exporting `derive(row, metadata): MoodId[]` — a pure function over the rule set. Empty input → empty array. | | |
| TASK-009 | Create `apps/server/src/watchlist/moods/cluster.ts` exporting `getSummary(ctx): Promise<{ clusters: MoodSummaryCluster[] }>`. Sweeps active rows via `repo.listAllActive`, fetches catalog meta batch, tallies, filters `count >= MIN_CLUSTER_SIZE`, caches 30 s per user via `availability-cache.ts`-style helper. Also expose `invalidate(userId)` for the mutation listener. | | |
| TASK-010 | Create `apps/server/src/watchlist/tonight/score.ts` exporting `score(item, prior?): number` per design §S.2 weights (in-progress +100, available+server +80, runtime sweet-spot +20, recency +15, diversity penalty against `prior`, awaiting/upcoming/unknown -1000). | | |
| TASK-011 | Create `apps/server/src/watchlist/tonight/pick.ts` exporting `pick(candidates): { items, partial }` — sort by `score` desc, hero = `sorted[0]`, alternates = next four passing the diversity filter against the hero. Also expose `invalidate(userId)`. | | |
| TASK-012 | Extend `apps/server/src/watchlist/repo.ts` with `listPageSorted(userId, { cursor, limit, sort, bucket, mood })` returning rows ordered per `sort`. For `recent` use the existing `(added_at DESC, id DESC)` keyset; for `alpha`/`runtime`/`status` materialize the full active set in-handler and slice by offset. Return the encoded cursor alongside rows. | | |
| TASK-013 | Add `paginateWithOvershoot(fetchFn, classifyFn, { cursor, limit })` helper in `apps/server/src/watchlist/service.ts` (or a sibling `pagination.ts` if it improves cohesion) covering the empty-hop loop from design §S.1. Used by both `listItems` (when filters drop rows) and `listMoodItems`. | | |
| TASK-014 | Add `listItems(ctx, opts)` to `apps/server/src/watchlist/service.ts`. Apply bucket pre-classify (existing `previewForClassify`), reuse `paginateWithOvershoot` when filters narrow the set, call `enrich` on the returned slice, return `{ items, cursor, partial }`. Without `bucket`, include "unknown" rows. | | |
| TASK-015 | Add `getTonightSection(ctx)` to `service.ts`. Loads active rows, pre-filters to ready+in-progress candidates via `previewForClassify`, enriches, calls `tonight/pick.ts`, caches result per user 5 min. | | |
| TASK-016 | Add `getRecentlyAdded(ctx, limit)` to `service.ts`. Sweeps active rows ordered by `addedAt DESC`, slices `limit`, enriches, returns `{ items, partial }`. No cursor. | | |
| TASK-017 | Add `getMoodSummary(ctx)` to `service.ts` delegating to `moods/cluster.ts::getSummary`. | | |
| TASK-018 | Add `listMoodItems(ctx, moodId, opts)` to `service.ts` using `paginateWithOvershoot` with `classifyFn` = `derive(row, meta).includes(moodId)`. | | |
| TASK-019 | Create `apps/server/src/watchlist/jobs/on-watchlist-mutation.ts` exporting `register()` that calls `on("watchlist.itemAdded", schema, ({userId}) => invalidate(userId))` and the matching `itemRemoved` listener. `invalidate(userId)` clears both the Tonight cache and the mood-summary cache. | | |
| TASK-020 | Add a `registerJobs()` function to `apps/server/src/watchlist/index.ts` that invokes the mutation-listener `register()` and any other module-scoped init. Wire it into the server bootstrap at `apps/server/src/index.ts` alongside other module job registrations. | | |
| TASK-021 | Extend `apps/server/src/api/procedures/watchlist.ts` (or split into smaller files if it grows past complexity threshold) to add: `GET /items` (zod-validated by `itemsQuerySchema`), `GET /sections/tonight`, `GET /sections/recently` (zod-validated by `recentlyQuerySchema`), `GET /moods`, `GET /moods/:moodId/items` (zod-validated by `moodParamSchema` + `moodItemsQuerySchema`). Existing `/counts`, `POST /`, `DELETE /:tmdbId/:mediaType` unchanged. | | |
| TASK-022 | Mark the legacy `GET /api/watchlist?filter=` path deprecated (JSDoc-only) and keep it functional so the existing client renders during the rollout. Removal happens in Phase 4. | | |
| TASK-023 | Verify `vp check` and `vp test` pass after the server additions. | | |

### Implementation Phase 2 — Client routes + per-section hooks

- GOAL-002: Replace the mega-hook `useWatchlistItems` with per-section hooks; add `/watchlist/all` and `/watchlist/moods/:moodId` routes; switch the curated page over to per-section Suspense boundaries.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | Create `apps/client/src/features/watchlist/lib/mood-registry.ts` mapping `MoodId → { labelKey, noteKey }` paraglide message keys. Imported only inside the feature. | | |
| TASK-025 | Replace `apps/client/src/features/watchlist/lib/fetchers.ts` with per-endpoint fetchers: `fetchCounts`, `fetchTonight`, `fetchRecently`, `fetchItems(params)`, `fetchMoods`, `fetchMoodItems(moodId, params)`. Reuse the existing api client pattern. | | |
| TASK-026 | Update `apps/client/src/features/watchlist/lib/query-keys.ts`: `watchlistKeys = { root, counts(), tonight(), recently(), moods(), moodItems(id), items(params) }`. All nested under the same `root`. | | |
| TASK-027 | Add `apps/client/src/features/watchlist/hooks/use-counts.ts`, `use-tonight.ts`, `use-ready-row.ts`, `use-moods.ts`, `use-mood-cluster.ts`, `use-coming-up.ts`, `use-awaiting.ts`, `use-recently-added.ts`, `use-all-items.ts`. Use `useSuspenseQuery` for capped strips (Tonight, Recently, Moods summary) and `useSuspenseInfiniteQuery` for paginated grids (Ready, Awaiting, Upcoming, AllItems, MoodCluster). | | |
| TASK-028 | Update `apps/client/src/features/watchlist/hooks/use-is-in-watchlist.ts` to read presence across the cached items in `watchlistKeys.root` (any sub-key) instead of the single `useWatchlistItems` cache. | | |
| TASK-029 | Update `apps/client/src/features/watchlist/hooks/use-add-to-watchlist.ts` and `use-remove-from-watchlist.ts` to invalidate `watchlistKeys.root` exactly once on settle. Optimistic snapshot/restore behavior unchanged. | | |
| TASK-030 | Move existing section components into `apps/client/src/features/watchlist/components/sections/`: flatten single-file sections (`tonight-pick.tsx`, `ready-row.tsx`, `coming-up.tsx`, `awaiting.tsx`, `recently-added.tsx`); keep folders for `mood-mosaic/` (`index.tsx`, `mood-cluster.tsx`) and add a new `all-items/` folder (`index.tsx`, `sort-select.tsx`, `bucket-chips.tsx`). | | |
| TASK-031 | Wire each section component to its hook. Each `<Section>` is wrapped at its render site in `<ErrorBoundary><Suspense fallback={<SectionSkeleton/>}> ... </Suspense></ErrorBoundary>`. Mood mosaic composes `useMoods` for the summary and `useMoodCluster(id)` per cluster card (limit=3 preview). | | |
| TASK-032 | Refactor `apps/client/src/features/watchlist/components/watchlist-content.tsx` into `apps/client/src/features/watchlist/components/watchlist-page.tsx` (curated layout). Drop the old single-fetch `useWatchlistItems` consumer in favor of per-section components. | | |
| TASK-033 | Create `apps/client/src/features/watchlist/components/watchlist-all-page.tsx`. Reads `bucket?`, `sort?`, `mood?` from search params, drives `useAllItems({sort, bucket, mood})`, renders `<AllItems/>` (virtualized infinite grid) inside its Suspense. | | |
| TASK-034 | Create `apps/client/src/features/watchlist/components/watchlist-mood-page.tsx`. Reads `moodId` path param, drives `useMoodCluster(moodId)` with default limit=60, renders a virtualized infinite grid. Unknown `moodId` (server 400) propagates to the route ErrorBoundary fallback. | | |
| TASK-035 | Add route files `apps/client/src/routes/_authenticated/_app/watchlist.all.tsx`, `apps/client/src/routes/_authenticated/_app/watchlist.moods.$moodId.tsx`. Each registers a loader that calls `ensureQueryData(watchlistKeys.counts())` only. | | |
| TASK-036 | Update `apps/client/src/routes/_authenticated/_app/watchlist.tsx` loader to call `ensureQueryData(watchlistKeys.counts())` only. Remove the prior reliance on `useWatchlistItems` Suspense at the page root. | | |
| TASK-037 | Regenerate `apps/client/src/routeTree.gen.ts` via the TanStack Router CLI/Vite plugin. | | |
| TASK-038 | Add paraglide message keys for any new chrome (mood labels per `MOOD_IDS`, "View all items", "See all", sort dropdown labels reused if present) to `apps/client/messages/en.json`. | | |
| TASK-039 | Verify `vp check` and `vp test` pass after Phase 2 lands. | | |

### Implementation Phase 3 — Header refactor + navigation wiring

- GOAL-003: Make the header `mode`-aware and turn bucket chips into navigation rather than local filter state.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-040 | Refactor `apps/client/src/features/watchlist/components/watchlist-header.tsx` to accept `mode: "curated" | "flat"`. Curated mode hides bucket chips and the sort dropdown. Flat mode shows both and pushes `bucket` / `sort` updates via `navigate({ to: ".", search: ... })`. | | |
| TASK-041 | Remove the in-progress chip from the header. Keep `WatchlistCounts.inProgress` in the wire (placeholder `0`). Per-card "in-progress" overlay continues using `classifyStatus(item)` from `lib/classify.ts`. | | |
| TASK-042 | Add a "View all" link at the top of the curated layout navigating to `/watchlist/all`. | | |
| TASK-043 | Update the "See all" action in `mood-mosaic/mood-cluster.tsx` to navigate to `/watchlist/moods/:moodId` instead of `onPeek(items[0].id)`. | | |
| TASK-044 | Ensure the `mode` prop is exhaustively switched at the call site (TS compile-time guard for V.WL6). | | |
| TASK-045 | Verify `vp check` and `vp test` pass after Phase 3 lands. | | |

### Implementation Phase 4 — Cleanup

- GOAL-004: Remove legacy code now that callers have migrated.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-046 | Delete `apps/client/src/features/watchlist/lib/derive-moods.ts`. | | |
| TASK-047 | Delete `apps/client/src/features/watchlist/__tests__/derive-moods.test.ts`. | | |
| TASK-048 | Delete `apps/client/src/features/watchlist/hooks/use-watchlist-items.ts` and its test if one exists. Update the feature barrel `apps/client/src/features/watchlist/index.ts`. | | |
| TASK-049 | Remove the legacy `?filter=` path from `apps/server/src/api/procedures/watchlist.ts` and the `getItems(opts.filter)` overload in `apps/server/src/watchlist/service.ts`. Drop `WATCHLIST_LIST_DEFAULT_LIMIT` / `WATCHLIST_LIST_MAX_LIMIT` if unused, otherwise move them under the `/items` route constants. | | |
| TASK-050 | Complete the `WatchlistListFilter` → `WatchlistBucket` rename across any remaining references the earlier phases missed. Confirm `vp check` reports zero TS errors. | | |
| TASK-051 | Confirm `apps/client/src/features/watchlist/components/watchlist-filtered-grid.tsx` is either deleted (functionality moved to `all-items/`) or refactored into the new flat-page grid. | | |
| TASK-052 | Verify `vp check` and `vp test` pass after Phase 4 lands. | | |

### Implementation Phase 5 — Changesets + PR

- GOAL-005: Create the changesets and open a pull request following the project template.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-053 | Create `.changeset/feat-watchlist-sections.md` with `"@nama/client": minor` frontmatter and a one-sentence end-user description (e.g., "Watchlist page now lists every item in a sortable flat view and shows a paginated per-mood listing when 'See all' is selected."). | | |
| TASK-054 | Create `.changeset/internal-watchlist-server-sections.md` with empty frontmatter (`---\n---`) for the server-only changes per CLAUDE.md "internal-only" rule. | | |
| TASK-055 | Open a PR using `.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`. Body links the design doc, lists the phases that landed, and includes the manual verification checklist below. | | |

### Implementation Phase 6 — Tests

- GOAL-006: Cover the new server logic and client routes; pin each invariant.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-056 | Extend `apps/server/src/watchlist/__tests__/service.test.ts` with: `listItems` returns "unknown"-bucket rows when `bucket` omitted (V.WL2); each sort variant orders correctly; cursor stability for `recent`; offset-snapshot best-effort note for `alpha/runtime/status`; mood intersect; legacy filter path still works until Phase 4. | | |
| TASK-057 | Create `apps/server/src/watchlist/tonight/__tests__/score.test.ts` covering scoring weight ordering, runtime sweet-spot, in-progress wins, diversity penalty, deterministic ties (V.WL4). | | |
| TASK-058 | Create `apps/server/src/watchlist/tonight/__tests__/pick.test.ts` covering hero + ≤4 alternates, empty candidates → empty result, awaiting/upcoming penalized out of selection. | | |
| TASK-059 | Create `apps/server/src/watchlist/moods/__tests__/derive.test.ts` covering each rule in `MOOD_RULES`, multi-tag overlap, empty metadata → empty array (V.WL3). | | |
| TASK-060 | Create `apps/server/src/watchlist/moods/__tests__/cluster.test.ts` covering aggregate tally accuracy, `count < MIN_CLUSTER_SIZE` filtered out, cache hit on second call within TTL, invalidation on mutation event. | | |
| TASK-061 | Create or extend `apps/server/src/api/__tests__/watchlist-routes.test.ts` to cover all five new endpoints: zod validation failure (400), happy-path 200 with expected shape, unknown `moodId` 400, invalid `sort` 400. | | |
| TASK-062 | Create `apps/client/src/features/watchlist/__tests__/use-all-items.test.ts` covering Suspense load, `sort` param round-trip, cursor handoff through `fetchNextPage`. | | |
| TASK-063 | Create `apps/client/src/features/watchlist/__tests__/use-moods.test.ts` covering summary + cluster items hook composition. | | |
| TASK-064 | Create `apps/client/src/features/watchlist/__tests__/header.test.ts` covering `mode` prop branches and the exhaustive switch (compile-time guard for V.WL6); bucket chip click navigates. | | |
| TASK-065 | Extend `apps/client/src/features/watchlist/__tests__/use-add-to-watchlist.test.ts` to assert `invalidateQueries({ queryKey: watchlistKeys.root })` is called exactly once on settle (V.WL5). | | |
| TASK-066 | Create `apps/client/src/features/watchlist/__tests__/watchlist-mood-page.test.tsx` covering 400 on unknown `moodId` → ErrorBoundary fallback render (V.WL7). | | |

### Implementation Phase 7 — Verification

- GOAL-007: Run the full verification suite and manually validate the user-facing behavior.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-067 | Run `vp install` (refresh deps after shared subpath additions, if any). | | |
| TASK-068 | Run `vp check` and resolve any failures. | | |
| TASK-069 | Run `vp test` and confirm all new and existing tests pass. | | |
| TASK-070 | Manual verify (`vp dev`): with a seeded user having >60 watchlist items, open `/watchlist` → curated layout renders, "View all" link works; open `/watchlist/all?sort=alpha` → flat grid lists every item alphabetically, paginated; open a mood cluster's "See all" → `/watchlist/moods/:id` lists the full mood cluster; add and remove a watchlist item → Tonight Pick and Mood Mosaic update on next navigation (cache invalidated). | | |

## 3. Alternatives

- **ALT-001**: Single `/api/watchlist?view=` endpoint with a discriminated response union. Rejected — `mood-summary` would need a different response shape than `items`, breaking the "URI identifies one representation" REST norm and making typed clients narrow before use. (See design §1 endpoint discussion.)
- **ALT-002**: Client-side mood derivation with `moodTags` shipped on every item. Rejected — `MoodCluster` counts would remain partial across loaded pages and the "See all" target still requires a server endpoint anyway. Server-side mood derivation is simpler end-to-end.
- **ALT-003**: Heuristic auto-switch from curated to flat layout above N items. Rejected — surprises users with magic thresholds; an explicit "View all" link is clearer.
- **ALT-004**: Server-managed `title_norm` column with a backfill migration to support alpha-sort keyset. Rejected — adds a write-time dependency on catalog metadata and a one-shot backfill job; in-memory sort over the active set (~1000 typical) is acceptable and avoids the migration.
- **ALT-005**: Promote `in-progress` to a true `bucket` enum value now. Rejected — depends on the host progress aggregator which has not landed; defer to a follow-up amendment.

## 4. Dependencies

- **DEP-001**: Drizzle ORM + existing `watchlist_items` / `user_watchlist_seed` schema (no migration required).
- **DEP-002**: `MediaService` per-user methods `getStatusBatch`, `getMatchingServers`, `getMetadata`, `getWatchlistFeed` — existing.
- **DEP-003**: `CatalogService.getMetadataBatch({tmdbId, type}[])` — existing; reused for alpha sort and mood derivation.
- **DEP-004**: `availability-cache.ts`-style per-user cache helper for the Tonight (5 min) and mood-summary (30 s) entries.
- **DEP-005**: Event bus `emit(name, schema, payload)` + `on(name, schema, handler)` from `apps/server/src/jobs/events.ts` — existing.
- **DEP-006**: TanStack Router `createFileRoute` + loader API — existing.
- **DEP-007**: `@tanstack/react-query` `useSuspenseQuery` + `useSuspenseInfiniteQuery` — existing.
- **DEP-008**: Paraglide messages compiler — existing.
- **DEP-009**: `VirtualGrid` / `VirtualWindowList` from `@/shared/components/virtualized` — existing.

## 5. Files

- **FILE-001**: `packages/shared/src/watchlist/enums.ts` (UPDATE) — add `WATCHLIST_SORTS`, `WATCHLIST_BUCKETS`, `MOOD_IDS`, `MIN_CLUSTER_SIZE`.
- **FILE-002**: `packages/shared/src/watchlist/types.ts` (UPDATE) — add `WatchlistSort`, `WatchlistBucket`, `MoodId`, `MoodSummaryCluster`, `WatchlistMoodSummary`, `TonightSection`, `RecentlySection`; rename `WatchlistListFilter` → `WatchlistBucket`.
- **FILE-003**: `packages/shared/src/watchlist/schemas.ts` (UPDATE) — add `itemsQuerySchema`, `recentlyQuerySchema`, `moodItemsQuerySchema`, `moodParamSchema`.
- **FILE-004**: `packages/shared/src/watchlist/index.ts` (UPDATE) — barrel re-exports.
- **FILE-005**: `apps/server/src/watchlist/moods/registry.ts` (NEW).
- **FILE-006**: `apps/server/src/watchlist/moods/derive.ts` (NEW).
- **FILE-007**: `apps/server/src/watchlist/moods/cluster.ts` (NEW).
- **FILE-008**: `apps/server/src/watchlist/tonight/score.ts` (NEW).
- **FILE-009**: `apps/server/src/watchlist/tonight/pick.ts` (NEW).
- **FILE-010**: `apps/server/src/watchlist/service.ts` (UPDATE) — add `listItems`, `getTonightSection`, `getRecentlyAdded`, `getMoodSummary`, `listMoodItems`, `paginateWithOvershoot` helper.
- **FILE-011**: `apps/server/src/watchlist/repo.ts` (UPDATE) — add `listPageSorted` with sort-variant cursor handling.
- **FILE-012**: `apps/server/src/watchlist/jobs/on-watchlist-mutation.ts` (NEW) — cache invalidation listener.
- **FILE-013**: `apps/server/src/watchlist/index.ts` (UPDATE) — `registerJobs()` and new barrel exports.
- **FILE-014**: `apps/server/src/index.ts` (UPDATE) — call watchlist `registerJobs()` at bootstrap.
- **FILE-015**: `apps/server/src/api/procedures/watchlist.ts` (UPDATE) — add five new routes.
- **FILE-016**: `apps/server/src/watchlist/__tests__/service.test.ts` (UPDATE) — new test cases for `listItems` sort + bucket-omit + mood intersect, plus legacy filter regression coverage until Phase 4.
- **FILE-017**: `apps/server/src/watchlist/tonight/__tests__/score.test.ts` (NEW).
- **FILE-018**: `apps/server/src/watchlist/tonight/__tests__/pick.test.ts` (NEW).
- **FILE-019**: `apps/server/src/watchlist/moods/__tests__/derive.test.ts` (NEW).
- **FILE-020**: `apps/server/src/watchlist/moods/__tests__/cluster.test.ts` (NEW).
- **FILE-021**: `apps/server/src/api/__tests__/watchlist-routes.test.ts` (NEW or UPDATE).
- **FILE-022**: `apps/client/src/features/watchlist/lib/mood-registry.ts` (NEW).
- **FILE-023**: `apps/client/src/features/watchlist/lib/fetchers.ts` (UPDATE) — per-endpoint fetchers.
- **FILE-024**: `apps/client/src/features/watchlist/lib/query-keys.ts` (UPDATE) — per-section key factory.
- **FILE-025**: `apps/client/src/features/watchlist/hooks/use-counts.ts` (NEW).
- **FILE-026**: `apps/client/src/features/watchlist/hooks/use-tonight.ts` (NEW).
- **FILE-027**: `apps/client/src/features/watchlist/hooks/use-ready-row.ts` (NEW).
- **FILE-028**: `apps/client/src/features/watchlist/hooks/use-moods.ts` (NEW).
- **FILE-029**: `apps/client/src/features/watchlist/hooks/use-mood-cluster.ts` (NEW).
- **FILE-030**: `apps/client/src/features/watchlist/hooks/use-coming-up.ts` (NEW).
- **FILE-031**: `apps/client/src/features/watchlist/hooks/use-awaiting.ts` (NEW).
- **FILE-032**: `apps/client/src/features/watchlist/hooks/use-recently-added.ts` (NEW).
- **FILE-033**: `apps/client/src/features/watchlist/hooks/use-all-items.ts` (NEW).
- **FILE-034**: `apps/client/src/features/watchlist/hooks/use-is-in-watchlist.ts` (UPDATE) — predicate over `watchlistKeys.root`.
- **FILE-035**: `apps/client/src/features/watchlist/hooks/use-add-to-watchlist.ts` (UPDATE) — invalidate `watchlistKeys.root` once on settle.
- **FILE-036**: `apps/client/src/features/watchlist/hooks/use-remove-from-watchlist.ts` (UPDATE) — same.
- **FILE-037**: `apps/client/src/features/watchlist/hooks/use-watchlist-items.ts` (DELETE in Phase 4).
- **FILE-038**: `apps/client/src/features/watchlist/components/sections/tonight-pick.tsx` (MOVE from current path).
- **FILE-039**: `apps/client/src/features/watchlist/components/sections/ready-row.tsx` (MOVE).
- **FILE-040**: `apps/client/src/features/watchlist/components/sections/coming-up.tsx` (MOVE).
- **FILE-041**: `apps/client/src/features/watchlist/components/sections/awaiting.tsx` (MOVE).
- **FILE-042**: `apps/client/src/features/watchlist/components/sections/recently-added.tsx` (MOVE).
- **FILE-043**: `apps/client/src/features/watchlist/components/sections/mood-mosaic/index.tsx` (MOVE).
- **FILE-044**: `apps/client/src/features/watchlist/components/sections/mood-mosaic/mood-cluster.tsx` (MOVE).
- **FILE-045**: `apps/client/src/features/watchlist/components/sections/all-items/index.tsx` (NEW).
- **FILE-046**: `apps/client/src/features/watchlist/components/sections/all-items/sort-select.tsx` (NEW).
- **FILE-047**: `apps/client/src/features/watchlist/components/sections/all-items/bucket-chips.tsx` (NEW).
- **FILE-048**: `apps/client/src/features/watchlist/components/watchlist-page.tsx` (UPDATE) — curated layout consuming per-section hooks.
- **FILE-049**: `apps/client/src/features/watchlist/components/watchlist-all-page.tsx` (NEW).
- **FILE-050**: `apps/client/src/features/watchlist/components/watchlist-mood-page.tsx` (NEW).
- **FILE-051**: `apps/client/src/features/watchlist/components/watchlist-header.tsx` (UPDATE) — `mode` prop, drop in-progress chip.
- **FILE-052**: `apps/client/src/features/watchlist/components/watchlist-content.tsx` (DELETE — replaced by `watchlist-page.tsx`).
- **FILE-053**: `apps/client/src/features/watchlist/components/watchlist-filtered-grid.tsx` (DELETE in Phase 4 — replaced by `all-items/`).
- **FILE-054**: `apps/client/src/routes/_authenticated/_app/watchlist.tsx` (UPDATE) — loader fetches `/counts` only.
- **FILE-055**: `apps/client/src/routes/_authenticated/_app/watchlist.all.tsx` (NEW).
- **FILE-056**: `apps/client/src/routes/_authenticated/_app/watchlist.moods.$moodId.tsx` (NEW).
- **FILE-057**: `apps/client/src/routeTree.gen.ts` (REGENERATE).
- **FILE-058**: `apps/client/src/features/watchlist/lib/derive-moods.ts` (DELETE in Phase 4).
- **FILE-059**: `apps/client/src/features/watchlist/__tests__/derive-moods.test.ts` (DELETE in Phase 4).
- **FILE-060**: `apps/client/src/features/watchlist/__tests__/use-all-items.test.ts` (NEW).
- **FILE-061**: `apps/client/src/features/watchlist/__tests__/use-moods.test.ts` (NEW).
- **FILE-062**: `apps/client/src/features/watchlist/__tests__/header.test.ts` (NEW).
- **FILE-063**: `apps/client/src/features/watchlist/__tests__/use-add-to-watchlist.test.ts` (UPDATE).
- **FILE-064**: `apps/client/src/features/watchlist/__tests__/watchlist-mood-page.test.tsx` (NEW).
- **FILE-065**: `apps/client/messages/en.json` (UPDATE) — paraglide keys for mood labels, "View all", "See all", sort labels (if not already present).
- **FILE-066**: `.changeset/feat-watchlist-sections.md` (NEW) — single user-facing changeset.
- **FILE-067**: `.changeset/internal-watchlist-server-sections.md` (NEW) — empty-frontmatter internal changeset for server changes.

## 6. Testing

- **TEST-001**: `listItems` without `bucket` returns "unknown"-classified rows (V.WL2).
- **TEST-002**: `listItems` cursor for `sort=recent` is strictly stable across mutations between page fetches; `sort=alpha|runtime|status` documents best-effort offset semantics (V.WL1).
- **TEST-003**: `listItems` with `mood` intersects with `bucket` correctly.
- **TEST-004**: Tonight `score.ts` weight ordering matches design §S.2 — in-progress beats available; awaiting/upcoming/unknown penalized (V.WL4).
- **TEST-005**: Tonight `pick.ts` returns hero + ≤4 alternates with diversity filtering; empty candidates → empty payload.
- **TEST-006**: `derive(row, meta)` triggers exactly the expected `MoodId[]` for each rule and is pure (V.WL3).
- **TEST-007**: `getMoodSummary` tally matches fixture, filters out `count < MIN_CLUSTER_SIZE`, hits cache on second call within TTL, invalidates on mutation event.
- **TEST-008**: Route integration — each new endpoint returns 200 + expected shape; zod validation failures yield 400 envelope; unknown `moodId` → 400.
- **TEST-009**: `useAllItems` hook Suspense load + cursor handoff round-trip via mocked fetcher.
- **TEST-010**: `useMoods` + `useMoodCluster` hook composition: summary fetch then per-cluster preview, "See all" path uses default `limit=60`.
- **TEST-011**: `WatchlistHeader` `mode` prop exhaustively switched (compile-time guard for V.WL6); flat-mode chip click triggers `navigate`.
- **TEST-012**: `useAddToWatchlist` and `useRemoveFromWatchlist` call `invalidateQueries({queryKey: watchlistKeys.root})` exactly once on settle (V.WL5).
- **TEST-013**: `/watchlist/moods/:moodId` route renders ErrorBoundary fallback when the server returns 400 for an unknown moodId (V.WL7).

## 7. Risks & Assumptions

- **RISK-001**: Cache invalidation listener could double-register if `registerJobs()` is imported in test contexts. Mitigation: idempotent `register()` guarded by a module-level boolean, asserted by `cluster.test.ts`.
- **RISK-002**: In-memory sort cost for `alpha`/`runtime`/`status` grows linearly with the active set. ≤ ~1000 typical is fine; benchmark at 2× before ship. Mitigation: surface partial when sort timeout budget exceeds the request deadline.
- **RISK-003**: Tonight scoring weights are cosmetic but visible. Mitigation: weights centralized in `tonight/score.ts`; add a snapshot test on a stable fixture so weight changes are intentional.
- **RISK-004**: Mood heuristics remain English-locale-bound (carried over from prior doc R1). Future numeric-genre-id work tracked separately.
- **RISK-005**: Below-fold first-paint fires up to five parallel section fetches. HTTP/2 multiplex handles this fine; enrich pipeline already memoizes within-request. Mitigation: keep an eye on `/counts` + `/sections/tonight` being the only loader-blocking calls.
- **RISK-006**: TanStack Router loader and `useSuspenseQuery` must share the same query key for the loader prefetch to hydrate the suspense read. Mitigation: tests for the loader prefetch + hook read pair.
- **RISK-007**: Removing the in-progress chip without removing the field from `WatchlistCounts` may confuse future readers. Mitigation: comment the placeholder explicitly in the type definition and link to the design doc.
- **ASSUMPTION-001**: `CatalogService.getMetadataBatch` is fast enough to be called inside `getMoodSummary` and the alpha/runtime/status sort path; existing 30 s availability cache pattern is adequate for the cluster tally.
- **ASSUMPTION-002**: The plugin SDK and released plugin packages do not import `WatchlistListFilter`; Phase 0 grep confirms.
- **ASSUMPTION-003**: `MediaService.getStatusBatch` and `getMatchingServers` continue to satisfy the existing `listItems` enrich shape.
- **ASSUMPTION-004**: `paraglideVitePlugin` regenerates `apps/client/src/paraglide/` from `messages/en.json` so new keys land without a manual compile step.

## 8. Related Specifications / Further Reading

- [Watchlist Sections design (rev 2)](../docs/2026-05-23-watchlist-sections-design.md)
- [Watchlist Backend Service design (rev 4)](../docs/2026-05-19-watchlist-backend-design.md)
- [Backend Feature Architecture skill](../.claude/skills/backend-feature-architecture/SKILL.md)
- [Frontend Feature Architecture skill](../.claude/skills/frontend-feature-architecture/SKILL.md)
- [Home Page Backend design](../docs/2026-05-05-home-page-backend-design.md)
- [Catalog Service design](../docs/2026-04-27-catalog-service-design.md)

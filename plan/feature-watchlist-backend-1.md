---
goal: Implement internal watchlist backend service and replace mock data on the watchlist page with real data
version: 1.0
date_created: 2026-05-19
last_updated: 2026-05-19
owner: Omid Astaraki
status: 'Planned'
tags: [feature, backend, frontend, database, migration]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Build an internal watchlist module that owns user watchlist state, replacing the client-side mock data on the `/watchlist` page with real, DB-backed data. Plugins (Trakt, Jellyfin, etc.) seed the internal table via `watchlist@v1` capability on first GET and via a recurring cron job. Add/remove writes go to the internal table only (plugin writes deferred to v2). The existing home row `your-watchlist.ts` is rewired to delegate to the watchlist service so home and watchlist page share a single source of truth.

Design spec: [docs/2026-05-19-watchlist-backend-design.md](../docs/2026-05-19-watchlist-backend-design.md).

## 1. Requirements & Constraints

- **REQ-001**: Persist watchlist state in a new `watchlist_items` table; one row per `(user_id, tmdb_id, media_type)` via UNIQUE constraint, with `state ∈ {"active","removed"}` tombstone.
- **REQ-002**: First GET `/api/watchlist` triggers an eager seed from plugin `watchlist@v1` when the user has not been seeded.
- **REQ-003**: A cron job (`registerScheduledPerRow`) runs every 6h, iterates seeded users, and additively merges new plugin items into the internal table.
- **REQ-004**: Sync diff uses `allKnownKeys` (active ∪ removed) to prevent resurrecting user-removed items.
- **REQ-005**: `POST /api/watchlist` is idempotent: brand-new and reactivated rows return 201; already-active rows return 200 with no event emission.
- **REQ-006**: `DELETE /api/watchlist/:tmdbId/:mediaType` is fully idempotent: 204 on removed, already-removed, or never-existed.
- **REQ-007**: Home row `your-watchlist.ts` delegates to `watchlistService.listAvailable` and shows results filtered to library-available items.
- **REQ-008**: Client follows `frontend-feature-architecture` flat layout: components/, hooks/, lib/, __tests__/, __fixtures__/. One hook per file.
- **REQ-009**: All mutations use the optimistic-update pattern (cancel → snapshot → patch → onError restore → onSettled invalidate).
- **REQ-010**: Backend module follows `backend-feature-architecture`: owned tables read only by the module; outsiders call `service.*`.
- **SEC-001**: All routes require an authenticated session.
- **SEC-002**: Body and path params validated via zod; `tmdbId` matches `/^\d+$/`; `mediaType` enforced via shared `MEDIA_TYPES` tuple.
- **SEC-003**: `POST` body restricts `source` to `WATCHLIST_USER_SOURCES` (excludes `"plugin"`). Server-side default is `"manual"`.
- **SEC-004**: Rate-limit `POST` and `DELETE` per user via existing `TokenBucketLimiter` (`apps/server/src/mcp/rate-limit.ts` pattern) at the route boundary.
- **CON-001**: Pre-stable — no compat shims, no deprecation chains. Breaking changes to shared types are acceptable.
- **CON-002**: SQLite + drizzle-orm. Migration numbering follows existing `apps/server/drizzle/00XX_*.sql` sequence.
- **CON-003**: No imports from `apps/server/src/home/internal/*` (backend-feature-architecture rule 8 — module-private zone).
- **CON-004**: No `genreIds` end-to-end work in v1; mood derivation matches English genre name strings already on `CompactMediaItem.genres`.
- **CON-005**: No new shared utilities lifted from `home/internal` (e.g. `StatusBatchMemo` stays in home). Watchlist enrich calls `mediaService.getStatusBatch` directly with all keys in one call.
- **CON-006**: No `getProgress` per-key support — `mediaService.getProgress()` is a stub (`() → unknown[]`). Watchlist response omits `progress` field; client renders gracefully without it.
- **GUD-001**: Match existing module patterns — `apps/server/src/home/` (backend), `apps/client/src/features/notifications/` and `apps/client/src/features/home/` (frontend).
- **GUD-002**: Caveman ultra in design doc; normal prose in code, commits, and PR bodies.
- **GUD-003**: i18n via Paraglide `m.*` — no string literals in JSX outside stable code/IDs.
- **PAT-001**: Event emission wrapped in try/catch with `ctx.log.warn` on failure (at-most-once-after-commit semantics). Failed emit must NOT roll back the committed row.
- **PAT-002**: Use `emit(name, schema, payload)` from `apps/server/src/jobs/events.ts`. Define `WATCHLIST_EVENTS = [...] as const` plus exported zod schemas for both event payloads.
- **PAT-003**: Use `registerScheduledPerRow` with `rowSource: () → seeded users`, `continueOnRowError: true`. No `runAfter`-style ad-hoc enqueue.

## 2. Implementation Steps

### Implementation Phase 1 — Shared package + DB schema

- GOAL-001: Land shared types/enums/schemas and the watchlist DB tables.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `packages/shared/src/watchlist/enums.ts` exporting `WATCHLIST_STATES`, `WATCHLIST_SOURCES`, `WATCHLIST_USER_SOURCES` as `as const` tuples plus derived types. | | |
| TASK-002 | Create `packages/shared/src/watchlist/types.ts` exporting `WatchlistItem` (extends `CompactMediaItem` with `addedAt: number`, `addedSource: WatchlistSource`), `WatchlistResponse`, `AddWatchlistRequest`, `AddWatchlistResponse`. Export `keyToId({tmdbId, mediaType}): string` helper that returns `"{mediaType}:{tmdbId}"`. | | |
| TASK-003 | Create `packages/shared/src/watchlist/schemas.ts` with `addWatchlistRequestSchema` (zod: tmdbId regex `/^\d+$/`, mediaType enum, source enum w/ default `"manual"`) and `watchlistParamSchema` (tmdbId regex + mediaType enum). | | |
| TASK-004 | Create `packages/shared/src/watchlist/index.ts` barrel re-exporting enums + types + schemas. | | |
| TASK-005 | Add `"./watchlist"` subpath to `packages/shared/package.json` `exports` ({ types + default } pointing at `./src/watchlist/index.ts`). | | |
| TASK-006 | Create `apps/server/src/db/schema/watchlist.ts` defining drizzle tables `watchlistItems` (cols + UNIQUE + indexes) and `userWatchlistSeed` (PK user_id). Use `text("col", { enum: TUPLE })` for `state`, `source`, `media_type`. | | |
| TASK-007 | Export both tables from `apps/server/src/db/schema/index.ts`. | | |
| TASK-008 | Generate drizzle migration via project's drizzle CLI (use existing `vp` workflow if it exposes one, otherwise write SQL manually) at `apps/server/drizzle/00XX_add_watchlist.sql`. Include `watchlist_items` + `user_watchlist_seed` tables + indexes `(user_id, state, added_at)` and `(user_id, state)`. | | |
| TASK-009 | Verify `vp check` + `vp test` pass on the shared package and server with the new schema (no runtime usage yet). | | |

### Implementation Phase 2 — Backend module

- GOAL-002: Implement `apps/server/src/watchlist/` (repo, service, enrich, errors, events, jobs).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Create `apps/server/src/watchlist/errors.ts` with `WatchlistError` base and `WatchlistNotFoundError extends WatchlistError { code = "watchlist.not_found" }`. | | |
| TASK-011 | Create `apps/server/src/watchlist/events.ts` exporting `WATCHLIST_EVENTS = ["watchlist.itemAdded", "watchlist.itemRemoved"] as const`, `watchlistItemAddedSchema` (zod: userId, key, source, createdAt), `watchlistItemRemovedSchema` (zod: userId, key, removedAt). Type `WatchlistEvent = typeof WATCHLIST_EVENTS[number]`. | | |
| TASK-012 | Create `apps/server/src/watchlist/repo.ts` exporting: `list(userId, opts?)`, `findByKey(userId, key)`, `upsertActive(userId, key, source, now) → {row, created, wasActive}`, `softRemove(userId, key, now)`, `bulkInsertIgnoreConflict(userId, keys, source, seeded) → number`, `allKnownKeys(userId) → Set<string>`, `markSeeded(userId, now)` (`INSERT ... ON CONFLICT DO NOTHING` into `user_watchlist_seed`), `hasSeeded(userId)`, `hasAny(userId)`, `listAvailableKeys(userId, opts) → WatchlistRow[]`. `upsertActive` wraps logic in `db.transaction`; SQLite `BEGIN IMMEDIATE` serializes concurrent writers. | | |
| TASK-013 | Create `apps/server/src/watchlist/enrich.ts` exporting `enrich(rows, ctx) → {items: WatchlistItem[], partial: boolean}`. Use real API surface only: (a) `ctx.catalog.getMetadataBatch(keys)` where `keys` are `{tmdbId, type}` shape, (b) `ctx.mediaService.getStatusBatch(compositeIds)` ONE call up front, (c) `ctx.mediaService.getMatchingServers(tmdbId, type)` per-key (per-request memoization is built into MediaService), (d) `ctx.mediaService.getMetadata(tmdbId, type)` for cold-fill on metadata miss (returns `RawCanonicalSource | null`, NOT throws). DO NOT call `getProgress` (stub). DO NOT call `getRequestStatus` (does not exist). Track `partial` via `Promise.allSettled` for per-key fan-out. Output items follow `WatchlistItem` shape. | | |
| TASK-014 | Define `WatchlistContext` interface in `apps/server/src/watchlist/service.ts`: `{ userId, mediaService, catalog, deadlineMs?, log }`. The home `RowContext` (`apps/server/src/home/internal/types.ts`) structurally satisfies this — home row passes its existing ctx. | | |
| TASK-015 | Create `apps/server/src/watchlist/service.ts` with exported functions: `getItems(userId, ctx)`, `addItem(userId, key, source, ctx)`, `removeItem(userId, key, ctx)`, `seedFromPlugins(userId, ctx)`, `syncFromPlugins(userId, ctx)`, `listAvailable(userId, limit, ctx)`, `hasAny(userId)`. Drop `trySeedLock` — allow concurrent first-seed (bulk insert is idempotent via UNIQUE; `markSeeded` uses `INSERT OR IGNORE`). On seed plugin error: catch, return `partial: true`, do NOT `markSeeded` (next GET retries). Wrap each `emit(...)` call in `try/catch` with `ctx.log.warn` (at-most-once-after-commit). | | |
| TASK-016 | Implement `listAvailable` in service.ts: load up to `limit * 4` active rows, probe `getMatchingServers` per-key, accumulate items until `limit` reached, then call `enrich` on the picked subset. If user has no active rows and is not seeded, trigger `seedFromPlugins` then retry. Return `{items, partial}`. | | |
| TASK-017 | Create `apps/server/src/watchlist/jobs/sync-plugin-watchlist.ts` registering via `registerScheduledPerRow<{userId: string}>({ id: "watchlist.sync_plugin", schedule: "0 */6 * * *", rowSource: () => db.select(...).from(userWatchlistSeed), perRowTimeoutSec: 30, runTimeoutSec: 1800, continueOnRowError: true, handler: async (ctx, row) => service.syncFromPlugins(row.userId, ctx) })`. Confirm `runTimeoutSec` is sufficient by measuring expected user count × 30s; bump to 7200 if needed. | | |
| TASK-018 | Wire job registration in the server bootstrap (where other `registerScheduledPerRow` calls live; check `apps/server/src/jobs/registry.ts` or equivalent). | | |
| TASK-019 | Create `apps/server/src/watchlist/index.ts` barrel exporting service public functions + `WatchlistContext` type. | | |
| TASK-020 | Verify fallow zone-pair config: `apps/server/src/watchlist/**` is its own zone; tables `watchlist_items` + `user_watchlist_seed` listed as owned. Update `fallow.config.*` per backend-feature-architecture skill if needed. | | |

### Implementation Phase 3 — API routes

- GOAL-003: Expose watchlist via Hono RPC at `/api/watchlist`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | Create `apps/server/src/api/procedures/watchlist.ts` exporting a Hono sub-app with three routes: `GET /` → `service.getItems`; `POST /` → `service.addItem`; `DELETE /:tmdbId/:mediaType` → `service.removeItem`. | | |
| TASK-022 | Wire zod validation via `zValidator("json", addWatchlistRequestSchema)` on POST and `zValidator("param", watchlistParamSchema)` on DELETE. Standard 400 envelope on validation failure. | | |
| TASK-023 | POST handler: build `WatchlistContext` per-request (instantiate `new MediaService(userId)`, get `catalogService` singleton, set `deadlineMs: 5000`, logger), call `service.addItem`. Return 201 when `wasActive === false`, 200 when `wasActive === true`. Body: `AddWatchlistResponse`. | | |
| TASK-024 | DELETE handler: call `service.removeItem`. Return 204 unconditionally (never-existed and already-removed both succeed silently). | | |
| TASK-025 | GET handler: build context, call `service.getItems`, return 200 with `WatchlistResponse`. | | |
| TASK-026 | Map `WatchlistError` subclasses to standard `{ error: { code, message } }` envelope in an `onError` hook (mirror notifications route pattern). | | |
| TASK-027 | Register the sub-app in `apps/server/src/api/register-routes.ts` mounted at `/watchlist`. Ensure Hono RPC type `AppType` exposes `api.watchlist.*`. | | |
| TASK-028 | Apply session-auth middleware (same as home routes). | | |
| TASK-029 | Apply `TokenBucketLimiter` (or existing per-route rate limit pattern) to POST and DELETE; ~30/min/user. | | |

### Implementation Phase 4 — Home row rewire

- GOAL-004: Switch `your-watchlist.ts` home row to delegate to watchlist service.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-030 | Import `watchlistService` into `apps/server/src/home/rows/your-watchlist.ts`. | | |
| TASK-031 | Replace `eligibility(ctx)` body with: `return (await watchlistService.hasAny(ctx.userId)) || (await ctx.mediaService.hasCapabilityProvider("watchlist", "v1", "user"))`. | | |
| TASK-032 | Replace `fetchPage(ctx, cursor)` body with: `if (cursor) return { items: [], cursor: null }; const { items, partial } = await watchlistService.listAvailable(ctx.userId, PAGE_SIZE, ctx); return { items, cursor: null, partial };`. | | |
| TASK-033 | Update or replace existing `your-watchlist.ts` tests under `apps/server/src/home/__tests__/` to mock `watchlistService.listAvailable` instead of the old plugin-direct path. | | |

### Implementation Phase 5 — Client (frontend feature)

- GOAL-005: Replace mock data in `apps/client/src/features/watchlist/` with real fetchers, hooks, and components.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-034 | Delete `apps/client/src/features/watchlist/lib/mock-data.ts`. | | |
| TASK-035 | Update `apps/client/src/features/watchlist/lib/types.ts`: drop local `WatchlistItem` redefinition (use shared `@nama/shared/watchlist`); add `WatchlistApiError extends BaseApiError` (reuse existing client convention); add `sourceLabel(source: WatchlistSource) → string` mapping to paraglide `m.watchlist_source_*`. | | |
| TASK-036 | Drop `"friend"` from any local `RecentSourceKey` union if present (not in shared `WATCHLIST_SOURCES`). | | |
| TASK-037 | Create `apps/client/src/features/watchlist/lib/fetchers.ts` exporting `list()`, `add(input)`, `remove(tmdbId, mediaType)` using `api.watchlist.*`. Reuse existing `throwOnError` pattern from other features (e.g. `apps/client/src/features/home/lib/fetchers.ts`). | | |
| TASK-038 | Create `apps/client/src/features/watchlist/lib/query-keys.ts` exporting `watchlistKeys = { all: ["watchlist"] as const, list: () => [...watchlistKeys.all, "list"] as const }`. | | |
| TASK-039 | Create `apps/client/src/features/watchlist/lib/build-optimistic.ts` exporting `buildOptimistic(request, seed) → WatchlistItem` that combines partial seed metadata (title, poster, year, genres, mediaType, tmdbId, id) with `addedAt: Date.now()` and `addedSource: request.source ?? "manual"`. | | |
| TASK-040 | Create `apps/client/src/features/watchlist/lib/derive-moods.ts`. Define `MOOD_RULES` with two genre variants per cluster — `requireMovie` (English movie names: "Horror", "Drama", "Thriller", "Mystery", "Science Fiction", "History", "Comedy") and `requireTv` (English TV names: "Sci-Fi & Fantasy" for scifi, "War & Politics" optional, "Drama" + "Mystery" reused, "Comedy" reused). Match function: for each item, pick the variant by `item.mediaType` and require all listed names appear in `item.genres`. Threshold default 3. Items can appear in multiple clusters. | | |
| TASK-041 | Create `apps/client/src/features/watchlist/hooks/use-watchlist-items.ts` exporting `useWatchlistItems()` via `useSuspenseQuery({ queryKey: watchlistKeys.list(), queryFn: fetchers.list, staleTime: 60_000 })`. | | |
| TASK-042 | Create `apps/client/src/features/watchlist/hooks/use-is-in-watchlist.ts` exporting `useIsInWatchlist(id: string)` that reads `queryClient.getQueryData(watchlistKeys.list())` and returns `data?.items.some(i => i.id === id) ?? false`. Callers compose `id` via shared `keyToId`. | | |
| TASK-043 | Create `apps/client/src/features/watchlist/hooks/use-add-to-watchlist.ts`. Optimistic mutation with input `{ request: AddWatchlistRequest, seed?: Partial<WatchlistItem> }`. `onMutate`: cancel queries, snapshot, pre-check duplicate by `keyToId(request)` and short-circuit when found, skip optimistic when seed absent (notification deep-link path), otherwise prepend optimistic item. `onError`: always surface toast (`m.watchlist_add_error`), rollback only if not skipped. `onSettled`: invalidate `watchlistKeys.list()`. | | |
| TASK-044 | Create `apps/client/src/features/watchlist/hooks/use-remove-from-watchlist.ts`. Mirror add: cancel, snapshot, filter-out by composite id, onError toast + rollback, onSettled invalidate. | | |
| TASK-045 | Create `apps/client/src/features/watchlist/components/watchlist-skeleton.tsx` — Suspense fallback matching page layout shape. | | |
| TASK-046 | Create `apps/client/src/features/watchlist/components/watchlist-error-fallback.tsx` — ErrorBoundary fallback reading `WatchlistApiError` typed fields. | | |
| TASK-047 | Create `apps/client/src/features/watchlist/components/watchlist-toggle.tsx`. Props: `{ item: CompactMediaItem, source: WatchlistUserSource }`. Reads `useIsInWatchlist(item.id)`, dispatches add/remove mutation. Optimistic flip. Use shadcn button primitive. | | |
| TASK-048 | Create `apps/client/src/features/watchlist/components/watchlist-content.tsx` — consumes `useWatchlistItems()` (suspends). Hosts existing sub-components (TonightPick, ReadyRow, MoodMosaic, etc.) wired to real data via props. | | |
| TASK-049 | Update `apps/client/src/features/watchlist/components/watchlist-page.tsx` to wrap `WatchlistContent` in `ErrorBoundary > Suspense`. Keep existing filter/sort/peek URL state. Render `m.watchlist_partial_banner` when `data.partial === true`. | | |
| TASK-050 | Update existing sub-components (`tonight-pick.tsx`, `ready-row.tsx`, `mood-mosaic.tsx`, `awaiting.tsx`, `coming-up.tsx`, `recently-added.tsx`, `watchlist-filtered-grid.tsx`) to accept `WatchlistItem[]` via props. Remove any direct mock-data imports. `RecentlyAdded` sorts items by `addedAt DESC` and slices top 5; renders `sourceLabel(item.addedSource)` via paraglide. | | |
| TASK-051 | Update `apps/client/src/features/watchlist/index.ts` barrel to re-export `WatchlistPage`, `WatchlistToggle`, `useAddToWatchlist`, `useRemoveFromWatchlist`, `useIsInWatchlist` (for cross-feature consumers). | | |
| TASK-052 | Add paraglide message keys to `apps/client/src/messages/en.json` (or project's equivalent): `m.watchlist_page_title`, all `m.watchlist_filter_*`, `m.watchlist_sort_*`, `m.watchlist_source_*` (one per `WATCHLIST_SOURCES`), `m.mood_*` (one per mood id), `m.watchlist_partial_banner`, `m.watchlist_empty`, `m.watchlist_{tonight_pick,ready_row,mood_mosaic,coming_up,awaiting,recently_added}_title`, `m.watchlist_add_error`, `m.watchlist_remove_error`, `m.watchlist_toggle_{add,remove}`. | | |

### Implementation Phase 6 — Tests

- GOAL-006: Cover service, job, and client logic with tests verifying intent (CLAUDE.md rule 9).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-053 | Create `apps/server/src/watchlist/__tests__/service.test.ts` covering: first GET seeds and threads partial, second GET does not re-seed; `addItem` new (insert + event), `addItem` on removed (reactivate + event), `addItem` on active (200, no event); `removeItem` active/already-removed/never-existed all succeed with at-most one event; `removeItem` then sync does not resurrect (key in `allKnownKeys`); seed plugin throw → returns `partial: true`, does not mark seeded; sync plugin partial → returns `partial: true`; `listAvailable` pre-filters by `getMatchingServers` before full enrich. | | |
| TASK-054 | Create `apps/server/src/watchlist/__tests__/sync-plugin-watchlist.test.ts` covering: job registered with `schedule: "0 */6 * * *"`; `rowSource` returns seeded users; handler invokes `service.syncFromPlugins(userId, ctx)`; `continueOnRowError` honored when one row's plugin throws. | | |
| TASK-055 | Add an integration test in `apps/server/src/api/__tests__/` (or whatever route-tests folder exists) covering: `GET /api/watchlist` returns 200 w/ shape; `POST` 201 on new, 200 on already-active; `POST` 400 on invalid tmdbId; `POST` source=`"plugin"` rejected (400); `DELETE` 204 on all three idempotent cases; `DELETE` 400 on non-numeric tmdbId. | | |
| TASK-056 | Create `apps/client/src/features/watchlist/__tests__/use-watchlist-items.test.ts` — Suspense first-render seeds via mocked fetcher; error path propagates to ErrorBoundary. | | |
| TASK-057 | Create `apps/client/src/features/watchlist/__tests__/use-add-to-watchlist.test.ts` — optimistic insert with seed, pre-check duplicate short-circuits, skip-optimistic when seed absent (notification path) AND toast still shown on error, rollback on err, invalidate on settle. | | |
| TASK-058 | Create `apps/client/src/features/watchlist/__tests__/use-remove-from-watchlist.test.ts` — optimistic filter, rollback on err, invalidate on settle. | | |
| TASK-059 | Create `apps/client/src/features/watchlist/__tests__/derive-moods.test.ts` — movie name match, TV name match (e.g. `"Sci-Fi & Fantasy"` matches `scifi`), ≥3 threshold, multi-cluster overlap, items with numeric-string genres skip silently. | | |
| TASK-060 | Add `apps/client/src/features/watchlist/__fixtures__/watchlist-items.fixture.ts` providing canonical mock `WatchlistItem[]` arrays used across client tests. | | |
| TASK-061 | Update existing home row tests in `apps/server/src/home/__tests__/` to mock `watchlistService.listAvailable` (replaces the previous mediaService-direct mocking for `your-watchlist`). | | |

### Implementation Phase 7 — Verification + cleanup

- GOAL-007: Run full validation and write the changeset.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-062 | Run `vp install` (refresh deps after shared subpath addition). | | |
| TASK-063 | Run `vp check` (format + lint + typecheck) and fix any failures. | | |
| TASK-064 | Run `vp test` (full suite). All new and existing tests must pass. | | |
| TASK-065 | Manually verify in dev (`vp dev`): open `/watchlist` with a seeded user — items render; toggle add/remove on a search result — optimistic flip + persisted across reload; open `/home` — `Your Watchlist` row shows items added in-app and hides items removed in-app. | | |
| TASK-066 | Create `.changeset/feat-watchlist-backend.md` with frontmatter `"@nama/client": minor` and `"@nama/server": minor` and a one-sentence end-user description (Keep a Changelog style, past tense). | | |
| TASK-067 | Open PR using template at `.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`. Include summary, test plan, and link to the design spec. | | |

## 3. Alternatives

- **ALT-001**: Keep watchlist state plugin-only (no internal table). Rejected — users cannot add items the plugin doesn't have, and home/watchlist would diverge from any in-app state.
- **ALT-002**: Bidirectional sync (writes go to plugin too). Rejected for v1 — adds plugin-write capability surface (`watchlist@v1.addItem`) that does not exist on plugins yet; deferred to v2.
- **ALT-003**: Extract `StatusBatchMemo` and per-key availability helpers from `home/internal` into a shared `media/batches.ts`. Rejected — scope creep for this PR; current design uses `mediaService.getStatusBatch` directly in one call and relies on MediaService's built-in per-request memoization for `getMatchingServers`.
- **ALT-004**: Numeric TMDB genre IDs end-to-end (plugin → catalog → enrich → wire) for locale-stable moods. Rejected — requires plugin-mapper change, catalog schema migration, backfill, and shared-type breakage across ~25 files. Deferred to future work. v1 uses English genre names with a documented locale assumption.
- **ALT-005**: Ad-hoc per-user job re-enqueue with `runAfter` / `dedupKey`. Rejected — the existing jobs runtime exposes cron-based registration only (`registerScheduledPerRow`). Cron handles recovery across deploys without a separate sweep job.
- **ALT-006**: 409 on duplicate POST. Rejected — idempotent 200 is friendlier for retry-on-network-blip clients. A future strict-mode admin endpoint can reintroduce 409 if needed.

## 4. Dependencies

- **DEP-001**: Drizzle ORM (`drizzle-orm`) — existing; used for schema + migration.
- **DEP-002**: zod — existing; used for validation schemas in shared and route handlers.
- **DEP-003**: Hono + `@hono/zod-validator` — existing; used for route procedures.
- **DEP-004**: `@tanstack/react-query` (Suspense + mutations) — existing.
- **DEP-005**: React `<Suspense>` + `<ErrorBoundary>` (from `react-error-boundary` or project equivalent) — existing.
- **DEP-006**: Paraglide messages compiler — existing.
- **DEP-007**: Plugin `watchlist@v1` capability via `MediaService.getWatchlistFeed` — existing.
- **DEP-008**: Jobs runtime (`apps/server/src/jobs/`) — `registerScheduledPerRow`, `emit(name, schema, payload)`, `on(name, schema, handler)` — existing. No new primitives required.
- **DEP-009**: `MediaService` per-user instance (`new MediaService(userId)`) with methods `getMetadata`, `getMatchingServers`, `getStatusBatch`, `getWatchlistFeed` — existing and verified.
- **DEP-010**: `CatalogService.getMetadataBatch` accepting `{tmdbId, type}` keys — existing.

## 5. Files

- **FILE-001**: `apps/server/src/db/schema/watchlist.ts` (NEW) — drizzle table definitions for `watchlistItems` + `userWatchlistSeed`.
- **FILE-002**: `apps/server/src/db/schema/index.ts` (UPDATE) — re-export new tables.
- **FILE-003**: `apps/server/drizzle/00XX_add_watchlist.sql` (NEW) — migration.
- **FILE-004**: `packages/shared/src/watchlist/enums.ts` (NEW) — `WATCHLIST_STATES`, `WATCHLIST_SOURCES`, `WATCHLIST_USER_SOURCES`.
- **FILE-005**: `packages/shared/src/watchlist/types.ts` (NEW) — `WatchlistItem`, `WatchlistResponse`, `AddWatchlistRequest`, `AddWatchlistResponse`, `keyToId`.
- **FILE-006**: `packages/shared/src/watchlist/schemas.ts` (NEW) — zod schemas.
- **FILE-007**: `packages/shared/src/watchlist/index.ts` (NEW) — barrel.
- **FILE-008**: `packages/shared/package.json` (UPDATE) — add `"./watchlist"` subpath export.
- **FILE-009**: `apps/server/src/watchlist/repo.ts` (NEW).
- **FILE-010**: `apps/server/src/watchlist/service.ts` (NEW).
- **FILE-011**: `apps/server/src/watchlist/enrich.ts` (NEW).
- **FILE-012**: `apps/server/src/watchlist/errors.ts` (NEW).
- **FILE-013**: `apps/server/src/watchlist/events.ts` (NEW).
- **FILE-014**: `apps/server/src/watchlist/jobs/sync-plugin-watchlist.ts` (NEW).
- **FILE-015**: `apps/server/src/watchlist/index.ts` (NEW) — module barrel.
- **FILE-016**: `apps/server/src/watchlist/__tests__/service.test.ts` (NEW).
- **FILE-017**: `apps/server/src/watchlist/__tests__/sync-plugin-watchlist.test.ts` (NEW).
- **FILE-018**: `apps/server/src/api/procedures/watchlist.ts` (NEW) — Hono routes.
- **FILE-019**: `apps/server/src/api/register-routes.ts` (UPDATE) — mount `/watchlist`.
- **FILE-020**: `apps/server/src/home/rows/your-watchlist.ts` (UPDATE) — delegate to watchlist service.
- **FILE-021**: `apps/server/src/home/__tests__/your-watchlist.test.ts` (UPDATE) — mock watchlistService.
- **FILE-022**: `apps/client/src/features/watchlist/components/watchlist-page.tsx` (UPDATE) — Suspense + ErrorBoundary wiring.
- **FILE-023**: `apps/client/src/features/watchlist/components/watchlist-content.tsx` (NEW) — consumer of useWatchlistItems.
- **FILE-024**: `apps/client/src/features/watchlist/components/watchlist-skeleton.tsx` (NEW).
- **FILE-025**: `apps/client/src/features/watchlist/components/watchlist-error-fallback.tsx` (NEW).
- **FILE-026**: `apps/client/src/features/watchlist/components/watchlist-toggle.tsx` (NEW).
- **FILE-027**: `apps/client/src/features/watchlist/components/{tonight-pick,ready-row,mood-mosaic,awaiting,coming-up,recently-added,watchlist-filtered-grid}.tsx` (UPDATE) — accept items as props, drop mock-data imports.
- **FILE-028**: `apps/client/src/features/watchlist/hooks/use-watchlist-items.ts` (NEW).
- **FILE-029**: `apps/client/src/features/watchlist/hooks/use-is-in-watchlist.ts` (NEW).
- **FILE-030**: `apps/client/src/features/watchlist/hooks/use-add-to-watchlist.ts` (NEW).
- **FILE-031**: `apps/client/src/features/watchlist/hooks/use-remove-from-watchlist.ts` (NEW).
- **FILE-032**: `apps/client/src/features/watchlist/lib/fetchers.ts` (NEW).
- **FILE-033**: `apps/client/src/features/watchlist/lib/query-keys.ts` (NEW).
- **FILE-034**: `apps/client/src/features/watchlist/lib/types.ts` (UPDATE) — drop local types, add `WatchlistApiError`, `sourceLabel`.
- **FILE-035**: `apps/client/src/features/watchlist/lib/derive-moods.ts` (NEW).
- **FILE-036**: `apps/client/src/features/watchlist/lib/build-optimistic.ts` (NEW).
- **FILE-037**: `apps/client/src/features/watchlist/lib/mock-data.ts` (DELETE).
- **FILE-038**: `apps/client/src/features/watchlist/index.ts` (UPDATE) — expanded barrel.
- **FILE-039**: `apps/client/src/features/watchlist/__tests__/{use-watchlist-items,use-add-to-watchlist,use-remove-from-watchlist,derive-moods}.test.ts` (NEW).
- **FILE-040**: `apps/client/src/features/watchlist/__fixtures__/watchlist-items.fixture.ts` (NEW).
- **FILE-041**: `apps/client/src/messages/en.json` (UPDATE) — paraglide keys.
- **FILE-042**: `.changeset/feat-watchlist-backend.md` (NEW) — semver bump + user-facing changelog line.

## 6. Testing

- **TEST-001**: `service.test.ts` — getItems first-run triggers seedFromPlugins and threads `partial`; second run does not re-seed; returns enriched items.
- **TEST-002**: `service.test.ts` — addItem new → 201-equivalent result, event emitted; addItem on removed → reactivate; addItem on active → no-op, no event.
- **TEST-003**: `service.test.ts` — removeItem on active → softRemove, event emitted; removeItem on already-removed / never-existed → no-op silently, no event.
- **TEST-004**: `service.test.ts` — removeItem then `syncFromPlugins` does not resurrect (key present in `allKnownKeys`).
- **TEST-005**: `service.test.ts` — seedFromPlugins on plugin throw → `{added: 0, partial: true}` and `hasSeeded` remains false.
- **TEST-006**: `service.test.ts` — `listAvailable` picks only items where `getMatchingServers` returns non-empty array; pre-filters before full enrich.
- **TEST-007**: `service.test.ts` — event emit error swallowed by try/catch; row commit persists; warning logged.
- **TEST-008**: `sync-plugin-watchlist.test.ts` — job registers with cron `"0 */6 * * *"`; `rowSource` SELECTs from `user_watchlist_seed`; one row's plugin throw does not stop other rows.
- **TEST-009**: route integration — POST 201 on new, 200 on already-active, 400 on `source: "plugin"`, 400 on non-numeric tmdbId; DELETE 204 idempotent across removed/already-removed/never-existed.
- **TEST-010**: `use-watchlist-items.test.ts` — Suspense seed via mocked fetcher; error path propagates to ErrorBoundary.
- **TEST-011**: `use-add-to-watchlist.test.ts` — optimistic insert with seed, duplicate short-circuit, no-seed notification path (skipped optimistic + error toast still surfaced), invalidate on settle.
- **TEST-012**: `use-remove-from-watchlist.test.ts` — optimistic filter-out, rollback on err, invalidate on settle.
- **TEST-013**: `derive-moods.test.ts` — movie genre names match; TV variants match (`"Sci-Fi & Fantasy"` → `scifi`); items with numeric-string genres skip silently; multi-cluster overlap; ≥3 threshold.
- **TEST-014**: Updated `your-watchlist.test.ts` (home) — fetchPage delegates to `watchlistService.listAvailable`; eligibility returns true when user has internal items even without a plugin.

## 7. Risks & Assumptions

- **RISK-001**: Catalog stores genre names in default (English) TMDB locale. Mood derivation breaks if catalog ever switches to localized fetches. Mitigation: documented as v1 assumption; future work tracked.
- **RISK-002**: TMDB plugin `mapGenres` falls back to numeric-string IDs when raw response omits names (search/trending endpoints). Items affected will not match any mood rule and will simply not appear in mood clusters. Acceptable graceful degradation.
- **RISK-003**: Concurrent first-GETs for the same user may both call `getWatchlistFeed`. Cost is two plugin calls in a narrow window; both bulk inserts are idempotent via UNIQUE constraint. Mitigation: accept the rare-case cost (no lock primitive needed).
- **RISK-004**: Event bus `emit` throws when no `on()` handler is registered (per existing infra). Mitigation: wrap every `emit` in try/catch + `ctx.log.warn`. Document at-most-once-after-commit semantics.
- **RISK-005**: `runTimeoutSec: 1800` for the cron job may be insufficient at large user counts. Mitigation: monitor first runs; raise to `7200` or shard by userId hash if needed.
- **RISK-006**: Home row eligibility now does two checks; each call is cheap (`hasAny` is a single EXISTS query; `hasCapabilityProvider` is a registry lookup). Cumulative cost across all rows on home page is negligible.
- **RISK-007**: `addItem`'s server-side enrich produces a full `WatchlistItem` even when `wasActive: true`. Wasted work but small. Mitigation: optional optimization — skip enrich on `wasActive` and return cached client copy.
- **RISK-008**: Cross-device staleness up to 60s + window-focus refetch. Acceptable for v1; WebSocket invalidation is future work.
- **ASSUMPTION-001**: `MediaService.getStatusBatch` accepts composite ID strings (`"movie:550"`) and returns a status map keyed by the same. Verified in exploration.
- **ASSUMPTION-002**: `CatalogService.getMetadataBatch` accepts `{tmdbId, type}` keys and returns a record keyed by composite id, with missing entries simply absent from the record. Verified.
- **ASSUMPTION-003**: Existing rate-limit middleware in the codebase can be reused on POST/DELETE without new infra. If `TokenBucketLimiter` does not have an HTTP-route wrapper, write a thin shim within this PR scope.
- **ASSUMPTION-004**: Paraglide message-keys infrastructure is set up; adding new keys requires only updating the message JSON file(s).
- **ASSUMPTION-005**: The `vp` toolchain's drizzle migration generator can be invoked to produce the migration; if not, the migration SQL can be hand-written following existing files under `apps/server/drizzle/`.

## 8. Related Specifications / Further Reading

- [Watchlist Backend Service design (rev 3)](../docs/2026-05-19-watchlist-backend-design.md)
- [Backend Feature Architecture skill](../.claude/skills/backend-feature-architecture/SKILL.md)
- [Frontend Feature Architecture skill](../.claude/skills/frontend-feature-architecture/SKILL.md)
- [Home Page Backend design](../docs/2026-05-05-home-page-backend-design.md)
- [Catalog Service design](../docs/2026-04-27-catalog-service-design.md)
- [Job Service design](../docs/2026-04-20-job-service-design.md)

---
goal: Implement home page backend — 6 stacked PRs (shared wire → catalog contributors → MediaService extensions → row providers → orchestrator → client integration)
version: 1.0
date_created: 2026-05-05
last_updated: 2026-05-05
owner: Omid Astaraki
status: "Planned"
tags: [feature, backend, home, server, client]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Replace the home-page mock data with real backend endpoints. Three RPCs (`home.getLayout`, `home.getRowContent`, `home.getDetails`) backed by a `RowProvider` registry where each row is an isolated module + colocated test. Heavy lifting reuses existing `CatalogService`, `MediaService`, `PreferenceEngine`. New persistence: `home_layout_cache` table + `host.home.layout_warm` hourly job. Wire format reshape in `@ent-mcp/shared/home` (MatchReason typed, HomeRowStub slug, +availability/facets/seriesContext). Per project memory, the project is pre-stable so DB and API breaking changes are acceptable; no compat shims.

Spec: `docs/superpowers/specs/2026-05-05-home-page-backend-design.md`

---

## 1. Requirements & Constraints

- **REQ-001**: Six PRs land in order. Each PR ships green CI alone; PR N depends on PR N-1 per spec §Implementation phases table. Skipping order breaks the build.
- **REQ-002**: `RowProvider` interface (`apps/server/src/home/types.ts`) is the only contract the orchestrator consumes for rows. Adding/editing a row = new file in `apps/server/src/home/rows/` + entry in `index.ts` + colocated test in `__tests__/`. Zero touches outside that directory.
- **REQ-003**: Each row pipeline gets a dedicated test file in `apps/server/src/home/rows/__tests__/<row>.test.ts`. CI fails when a row file lacks a matching test file (enforce via fallow zone scan or lint rule in PR 4).
- **REQ-004**: `CompactMediaItem.matchReason` ships as transitional union `string | MatchReason` from PR 1 through PR 5; narrowed to `MatchReason` object only in PR 6. Existing PE prose callers (catalog rec build, MCP discover tool) keep accepting `string`.
- **REQ-005**: `HomeRowStub.rowId` is a string slug (e.g. `"recommendedForYou-tv"`), `kind: RowKind` is the display category. Wire reshape lives in PR 1.
- **REQ-006**: `home_layout_cache` row carries a `schema_version` column. Reads with `schema_version !== CURRENT_SCHEMA_VERSION` are discarded (treated as cold). `CURRENT_SCHEMA_VERSION = 1` on first ship; bump on any `HomeLayoutResponse`/`HomeRowStub`/`LayoutHero` shape change.
- **REQ-007**: Cursor encoding is base64-url-encoded JSON, validated by zod on decode. Malformed cursors → `HttpError 400 "cursor_invalid"`. `becauseYouWatched` row rejects `cursor=null` after the initial call (its `initialCursor` is non-null seed encoding).
- **REQ-008**: Bounded rows (continueWatching-active, continueWatching-next, yourWatchlist, upcomingForYou) return all items in one page; cursor always `null`. Unbounded rows page at 12 items per call.
- **REQ-009**: `home.getLayout` warm path is one PK read against `home_layout_cache`. Cold path falls through to live composition + writeback. `host.home.layout_warm` (hourly, scheduled_per_row, `runTimeoutSec=30*60`) keeps the blob fresh per active user (activity in last 14 days).
- **REQ-010**: `home.getDetails` composition: catalog summary + `MediaService.getDetails` (live, dispatch-cached) + status batch. Plugin failure returns `{ summary, details: null, error: { code } }` not a thrown error.
- **REQ-011**: Hero `resumeUrl` is always `null` v1. Plugin SDK has no `playback@v1.getResumeUrl`; UI Play button = nav-to-detail.
- **REQ-012**: `LayoutHero.alternates` carries 4 items from the same source as the head. Empty when no alternates available.
- **REQ-013**: Each row attaches `matchReason` via `home/match-reason.ts` `pickMatchReason(rowId, item, ctx)`. `recommendedForYou-*` rows use `topContributors` snapshot from catalog; other rows use row-context heuristics.
- **REQ-014**: Status enrichment uses a request-scoped `StatusBatchMemo` (`home/status-batch.ts`) — one `getStatusBatch` round-trip per request even if multiple rows query overlapping ids.
- **CON-001**: Pre-stable project — DB schema and wire format breaking changes are acceptable. No compat shims, no deprecation chains.
- **CON-002**: Use Vite+ for all runs (`vp install`, `vp check`, `vp test`). Never invoke `pnpm`/`npm`/`yarn` directly.
- **CON-003**: All shared types in `@ent-mcp/shared/home` use `as const` tuples for enums (per `CLAUDE.md`).
- **CON-004**: Each PR ships a `.changeset/<slug>.md` per project rule: 1-2 sentences, end-user voice, past tense, `@ent-mcp/server` or `@ent-mcp/client` (or both) bump. Internal-only PRs (e.g. PR 3 MediaService extensions) ship empty frontmatter.
- **CON-005**: Tests colocate in `__tests__/` directories next to the file under test.
- **CON-006**: All utility imports use `es-toolkit` submodules.
- **GUD-001**: Files exceeding ~150 lines or handling 3+ concerns split into a sub-directory with named files per concern.
- **PAT-001**: Each row file exports `default` as a `RowProvider` instance. `apps/server/src/home/rows/index.ts` wires the registry.

---

## 2. Implementation Steps

### Phase 1 — PR `home-shared-wire`

- GOAL-001: Reshape `@ent-mcp/shared/home` types + enums + schemas. Type-only PR; no runtime change. App builds + tests pass with the wire reshape.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-001 | Edit `packages/shared/src/home/enums.ts` — add `MATCH_REASON_KEYS = [...] as const` (10 keys: `matches_recent_picks`, `from_genre_you_love`, `similar_to_seed`, `because_in_watchlist`, `continuing_series`, `upcoming_release`, `recently_added`, `highly_rated`, `from_active_series`, `finishing_soon`). Export `MatchReasonKey` derived type. | | |
| TASK-002 | Edit `packages/shared/src/home/types.ts` — add `MatchReason`, `Availability`, `Facets`, `SeriesContext` interfaces. Reshape `CompactMediaItem`: change `matchReason: string` → `matchReason?: string \| MatchReason` (transitional union; narrow in PR 6). Add `availability?`, `facets?`, `seriesContext?`, `tags?` (reserved). Add `MediaDetailsExtra`, `MediaDetailsResponse` interfaces. Reshape `HomeRowStub`: change `rowId: RowKind` → `rowId: string`, add `kind: RowKind`, rename `title` → `titleKey`, `subtitle` → `subtitleKey`. Reshape `LayoutHero`: add `alternates: CompactMediaItem[]`. | | |
| TASK-003 | Edit `packages/shared/src/home/schemas.ts` — relax `homeGetRowContentInputSchema.rowId` from `z.enum(ROW_KINDS)` to `z.string().min(1)`. Add `homeGetDetailsInputSchema` (`{ tmdbId, mediaType }`). Export derived input types. | | |
| TASK-004 | Write `packages/shared/src/home/__tests__/schemas.test.ts` — round-trip `getLayout`/`getRowContent`/`getDetails` zod schemas; reject malformed inputs. | | |
| TASK-005 | Edit `packages/shared/src/home/__tests__/home.test.ts` (or create) — verify `MATCH_REASON_KEYS` tuple length and member identity. | | |
| TASK-006 | Run `vp check` and `vp test` — all packages must compile + pass. Existing consumers of `CompactMediaItem.matchReason: string` continue to compile because of the transitional union. | | |
| TASK-007 | Write `.changeset/home-shared-wire.md` — `@ent-mcp/server` minor + `@ent-mcp/client` minor: "Updated home-feed wire format with typed match reasons, availability, facets, and series context." | | |

### Phase 2 — PR `home-catalog-contributors`

- GOAL-002: Persist `topContributors` snapshots into `recommendation_lists.items`. Update the catalog rec-build job. Drizzle migration (replace shape; pre-stable so no compat).

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-008 | Edit `apps/server/src/catalog/types.ts` — add `TopContributor` interface (`{ category: "genre"\|"person"\|"keyword"\|"decade"\|"language"\|"runtime"; value: string; weight: number }`). Add `topContributors: TopContributor[]` field to `RecItem` interface. | | |
| TASK-009 | Drizzle migration in `apps/server/src/db/schema/catalog.ts` — `recommendation_lists.items` JSON column shape change. No SQL DDL change (column type unchanged); generate a no-op migration if Drizzle requires one. Document the JSON shape in the schema comment. | | |
| TASK-010 | Edit `apps/server/src/catalog/jobs/recommendation-build.ts:125` — also persist `entry.topContributors.slice(0, 3)` alongside `match_reason`. Update `RecItem` constructor to include the field. | | |
| TASK-011 | Edit `apps/server/src/catalog/service.ts` — `getRecommendations` already returns `RecItem[]`; verify the new `topContributors` field flows through `JSON.parse` reads. Add migration handling: if a stored row pre-dates the field, default `topContributors: []` on read. | | |
| TASK-012 | Update `apps/server/src/catalog/__tests__/service.test.ts` (or add) — write a recommendation list with `topContributors`, read it back, assert round-trip. | | |
| TASK-013 | Update `apps/server/src/catalog/jobs/__tests__/recommendation-build.test.ts` — verify the job persists `topContributors`. | | |
| TASK-014 | Run `vp check` and `vp test`. | | |
| TASK-015 | Write `.changeset/home-catalog-contributors.md` — empty frontmatter (internal-only). | | |

### Phase 3 — PR `home-mediaservice-extensions`

- GOAL-003: Add `MediaService.getContinueWatchingFeed` and `MediaService.getMatchingServers`. Independent of PRs 1-2 — pure server-side method additions.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-016 | Edit `apps/server/src/media/service.ts` — add `getContinueWatchingFeed(opts: { deadlineMs?: number }): Promise<HomeAggregate<ContinueWatchingEntry[]>>`. Wraps `dispatchAggregate({ capability: "continueWatching", version: "v1", method: "getContinueWatching", input: {} })` + `interpretAggregate("continueWatching@v1", result)`. Mirror `getWatchlistFeed` pattern (line 449). | | |
| TASK-017 | Edit `apps/server/src/media/service.ts` — add `getMatchingServers(tmdbId: string): Promise<{ id: string; label: string }[]>`. Walks `resolveConnections` for plugins implementing `library@v1`; for each connection, checks if a copy exists for `tmdbId` (reuse `getStatusBatch` infrastructure). Returns sorted, deduped list. Cache result per-request via existing dataloader pattern. | | |
| TASK-018 | Write `apps/server/src/media/__tests__/get-continue-watching-feed.test.ts` — partial flag propagation, all-failed → throws, attempted=0 → empty. | | |
| TASK-019 | Write `apps/server/src/media/__tests__/get-matching-servers.test.ts` — multiple connections, dedup, server label resolution. | | |
| TASK-020 | Run `vp check` and `vp test`. | | |
| TASK-021 | Write `.changeset/home-mediaservice-extensions.md` — empty frontmatter (internal-only). | | |

### Phase 4 — PR `home-row-providers`

- GOAL-004: Implement the `RowProvider` abstraction, cursor codec, status-batch memo, and all 9 row pipelines + colocated tests. Not yet wired to the API.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-022 | Create directory `apps/server/src/home/`. | | |
| TASK-023 | Write `apps/server/src/home/types.ts` — `RowProvider` interface, `RowContext` shape, internal types per spec §RowProvider abstraction. | | |
| TASK-024 | Write `apps/server/src/home/cursor.ts` — `encodeCursor`, `decodeCursor`. Base64-url-encoded JSON. Each row uses its own zod schema for the inner shape; codec is generic. Throws `HttpError 400 "cursor_invalid"` on malformed input. | | |
| TASK-025 | Write `apps/server/src/home/status-batch.ts` — `StatusBatchMemo` class wrapping `MediaService.getStatusBatch`. Per-request cache. | | |
| TASK-026 | Write `apps/server/src/home/match-reason.ts` — `pickMatchReason(rowId, item, ctx)` per spec §Match-reason resolver. `mapTopContributor` helper for `recommendedForYou-*`. | | |
| TASK-027 | Write `apps/server/src/home/enrich.ts` — `enrich(items, ctx, opts)`. Calls `statusBatch.get`, `catalog.getMetadataBatch`, `capabilityRegistry.listProviders("requests","v1","user")`. Returns enriched items. `deriveAvailability`, `deriveFacets` helpers. | | |
| TASK-028 | Write `apps/server/src/home/rows/continue-watching-active.ts` — `RowProvider` impl per spec §Per-row pipelines. Filters `progressMs > 0 && progress < 0.85`. Bounded; cursor null. | | |
| TASK-029 | Write `apps/server/src/home/rows/continue-watching-next.ts` — filters `nextUp set OR progressMs absent`. Stitches `seriesContext.nextUpFromServer`. | | |
| TASK-030 | Write `apps/server/src/home/rows/because-you-watched.ts` — eligibility = history non-empty + similar capability present. `initialCursor` encodes `{ seedId, seedType, offset: 0 }`. `requiresInitialCursor: true` flag rejects null cursor at orchestrator. | | |
| TASK-031 | Write `apps/server/src/home/rows/recommended-for-you-tv.ts` — filters `mediaType === "tv"` AND `status !== "available"`. Carries `topContributors` through to enrichment. | | |
| TASK-032 | Write `apps/server/src/home/rows/recommended-for-you-movies.ts` — mirror tv variant. | | |
| TASK-033 | Write `apps/server/src/home/rows/your-watchlist.ts` — filters `status === "available"`. Bounded. | | |
| TASK-034 | Write `apps/server/src/home/rows/upcoming-for-you.ts` — wraps `getUpcomingFeed`. Bounded. | | |
| TASK-035 | Write `apps/server/src/home/rows/trending-now.ts` — reads `discover_snapshots[trending, popularity_desc, today]`. Pages by offset. | | |
| TASK-036 | Write `apps/server/src/home/rows/new-releases.ts` — reads `discover_snapshots[newReleases, release_date_asc, today]`. | | |
| TASK-037 | Write `apps/server/src/home/rows/index.ts` — `ROW_PROVIDERS: Record<string, RowProvider>` + `ROW_ORDER: string[]`. | | |
| TASK-038 | Write `apps/server/src/home/__tests__/cursor.test.ts` — encode/decode round-trip; malformed base64; malformed JSON; zod schema rejection. | | |
| TASK-039 | Write `apps/server/src/home/__tests__/match-reason.test.ts` — `finishing_soon` at >= 0.85; `similar_to_seed` includes seedTitle; `mapTopContributor` genre→`from_genre_you_love`; null for trending/newReleases. | | |
| TASK-040 | Write `apps/server/src/home/rows/__tests__/continue-watching-active.test.ts` — filter logic, pagination, partial flag. | | |
| TASK-041 | Write `apps/server/src/home/rows/__tests__/continue-watching-next.test.ts` — `nextUp` stitching, `nextUpFromServer` flag. | | |
| TASK-042 | Write `apps/server/src/home/rows/__tests__/because-you-watched.test.ts` — empty history → eligibility false; initialCursor encodes seed; pagination. | | |
| TASK-043 | Write `apps/server/src/home/rows/__tests__/recommended-for-you-tv.test.ts` — filter `mediaType=tv`, drop available, `topContributors` carry-through. | | |
| TASK-044 | Write `apps/server/src/home/rows/__tests__/recommended-for-you-movies.test.ts` — mirror tv variant. | | |
| TASK-045 | Write `apps/server/src/home/rows/__tests__/your-watchlist.test.ts` — filter status=available only. | | |
| TASK-046 | Write `apps/server/src/home/rows/__tests__/upcoming-for-you.test.ts` — bounded, partial on calendar plugin err. | | |
| TASK-047 | Write `apps/server/src/home/rows/__tests__/trending-now.test.ts` — reads day snapshot, paginates by offset. | | |
| TASK-048 | Write `apps/server/src/home/rows/__tests__/new-releases.test.ts` — mirror trending tests. | | |
| TASK-049 | Add fallow zone for `apps/server/src/home/**` in `.fallowrc.json`. Define a CI guard (lint rule or shell script in `vp check` pipeline) that scans `apps/server/src/home/rows/*.ts` and fails when a sibling `__tests__/<name>.test.ts` is missing. | | |
| TASK-050 | Run `vp check` and `vp test`. | | |
| TASK-051 | Write `.changeset/home-row-providers.md` — empty frontmatter (internal-only; no end-user surface yet). | | |

### Phase 5 — PR `home-orchestrator`

- GOAL-005: Wire the orchestrator, hero cascade, layout cache, layout-warm job, and Hono procedures. Endpoints become live on this PR but the client still hits mocks.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-052 | Write `apps/server/src/db/schema/home.ts` — `home_layout_cache` table (`user_id PK`, `schema_version int`, `blob text`, `generated_at int`, index on `generated_at`). Drizzle migration. | | |
| TASK-053 | Write `apps/server/src/home/layout-cache.ts` — `read`, `isFresh`, `write`, `CURRENT_SCHEMA_VERSION = 1` per spec §Layout cache. | | |
| TASK-054 | Write `apps/server/src/home/hero.ts` — `pickHero(ctx)` cascade: `pickContinueWatchingHero` → `pickRecommendedHero` → `pickTrendingHero` → `pickNewReleaseHero`. Each returns `{ item, alternates[] } \| null`. `resolveResumeUrl` returns `null` v1. | | |
| TASK-055 | Write `apps/server/src/home/errors.ts` — `classifyError(err)` → HostErrorCode mapping. | | |
| TASK-056 | Write `apps/server/src/home/orchestrator.ts` — `composeLayout`, `composeRow`, `composeDetails` per spec §Orchestrator. Cold-fill `composeDetails` path: `mediaService.getMetadata` → `catalog.writeMetadata` → refetch from catalog (per spec fix). | | |
| TASK-057 | Write `apps/server/src/home/jobs/layout-warm.ts` — `host.home.layout_warm` job (`scheduled_per_row`, hourly, `runTimeoutSec=30*60`). Selects active users (activity in last 14d), composes layout, writes back. Register in `apps/server/src/jobs/registry.ts`. | | |
| TASK-058 | Write `apps/server/src/api/procedures/home.ts` — Hono sub-app with three routes: `GET /layout`, `GET /row?rowId=&cursor=`, `GET /details?tmdbId=&mediaType=`. Use `zValidator` for inputs. | | |
| TASK-059 | Edit `apps/server/src/api/router.ts` — `.route("/home", homeApp)`. Import + register. | | |
| TASK-060 | Write `apps/server/src/home/__tests__/orchestrator.test.ts` — cached blob fresh path, stale fallthrough + writeback, 404 on unknown rowId, getDetails partial-on-plugin-fail, cold-fill catalog round-trip. | | |
| TASK-061 | Write `apps/server/src/home/__tests__/hero.test.ts` — cascade order, alternates exclude head, null on all empty. | | |
| TASK-062 | Write `apps/server/src/home/__tests__/layout-cache.test.ts` — read returns null on cold; write upserts; isFresh boundary at 60min; schema_version mismatch discards. | | |
| TASK-063 | Write `apps/server/src/home/jobs/__tests__/layout-warm.test.ts` — picks active users, composes + writes per user, idempotent. | | |
| TASK-064 | Write `apps/server/src/api/procedures/__tests__/home.test.ts` — 401 unauthenticated, 200 layout, 404 row, 200 details. | | |
| TASK-065 | Run `vp check` and `vp test`. | | |
| TASK-066 | Write `.changeset/home-orchestrator.md` — `@ent-mcp/server` minor: "Added home-feed RPC endpoints with layout, row pagination, and detail composition." | | |

### Phase 6 — PR `home-client-integration`

- GOAL-006: Replace `useHomeFeed` mock with TanStack Query against `/api/home/*`. Narrow `MatchReason` union to object-only. Delete mock files. Drop `facets.monochrome` and `seasons[]`.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-067 | Edit `packages/shared/src/home/types.ts` — narrow `CompactMediaItem.matchReason` from `string \| MatchReason` to `MatchReason` (drop transitional `string`). Server already emits typed; rec-list legacy callers must be migrated in the same PR. | | |
| TASK-068 | Edit `apps/server/src/catalog/jobs/recommendation-build.ts` — store typed `MatchReason` object alongside the prose string in a separate field if the prose string is still needed for MCP. (Or split: `matchReason: MatchReason \| null` for catalog row consumers, keep `prose: string \| null` for MCP discover tool.) | | |
| TASK-069 | Edit `apps/server/src/mcp/composite-tools/ent-discover.ts:218` — adapt to read prose from the new field. | | |
| TASK-070 | Edit `apps/client/src/features/home/lib/types.ts` — drop `facets.monochrome`. Drop `seasons[]` from `HomeMediaItem` (request flow owns it). Drop `MockEpisode`/`MockSeason`/`MockEpisodeStatus` types. | | |
| TASK-071 | Rewrite `apps/client/src/features/home/hooks/use-home-feed.ts` — return TanStack Query results from `GET /api/home/layout`. Hook interface stays the same: `useHomeFeed(): { data: HomeFeedData \| undefined; isLoading; error }`. | | |
| TASK-072 | Add `apps/client/src/features/home/hooks/use-home-row.ts` — TanStack Query for `GET /api/home/row?rowId=&cursor=`, infinite-pagination flavor. | | |
| TASK-073 | Add `apps/client/src/features/home/hooks/use-home-details.ts` — TanStack Query for `GET /api/home/details?tmdbId=&mediaType=`. Used by `MediaDetailModal`. | | |
| TASK-074 | Edit `apps/client/src/features/home/components/home-feed.tsx` — read items via `useHomeRow(rowId)` for each stub. Update typing for `item.matchReason` as `MatchReason` (object). | | |
| TASK-075 | Edit `apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx` — Play handler navigates to detail (no resumeUrl v1). | | |
| TASK-076 | Edit `apps/client/src/features/home/components/card/card-match-reason.tsx` — already keyed off `matchReasonKey`; verify no breakage when `item.matchReason` is now structured. | | |
| TASK-077 | Edit `apps/client/src/shared/components/media-detail-modal/index.tsx` — fetch via `useHomeDetails`. Modal seasons view stays empty (request flow owns it). | | |
| TASK-078 | Edit `apps/client/src/shared/components/media-detail-modal/modal-seasons.tsx` — render placeholder ("Seasons load with the request flow"). Drop `generateSeasons` logic. | | |
| TASK-079 | Update `apps/client/src/features/home/__tests__/card.test.tsx` — typed `matchReason` expectations. | | |
| TASK-080 | Update `apps/client/src/features/home/__tests__/use-home-feed.test.ts` — TanStack Query mocking; test loading + error states. | | |
| TASK-081 | Delete `apps/client/src/features/home/lib/mock-data.ts`. | | |
| TASK-082 | Delete `apps/client/src/features/home/lib/mock-pagination.ts`. | | |
| TASK-083 | Delete `apps/client/src/features/home/hooks/use-mock-pagination.ts`. | | |
| TASK-084 | Run `vp check` and `vp test`. | | |
| TASK-085 | Manual smoke: start `vp dev`, navigate home page, confirm rows load from `/api/home/*`, hero renders, modal fetches details. | | |
| TASK-086 | Write `.changeset/home-client-integration.md` — `@ent-mcp/client` minor: "Connected the home page to the live media-feed backend; replaced mock data with real recommendations and resumable progress." | | |

---

## 3. Alternatives

- **ALT-001**: Single PR for all backend work. Rejected — 80+ tasks, too large to review, no incremental ship-ability.
- **ALT-002**: PE refactor (`explainRanked` → typed object) instead of orchestrator-side mapping. Rejected — touches MCP tool + catalog rec-build job + breaks prose path. Orchestrator-side mapping isolates the typed-key concern to home backend.
- **ALT-003**: Per-row materialized cache table (`home_row_cache`). Rejected v1 — catalog already covers static-data rows sub-ms; live rows need freshness; deferrable to v2 if metrics demand.
- **ALT-004**: Tighten `continueWatching@v1` SDK default TTL from 5min to 2min. Rejected — affects all consumers, not just home; scope ⊥ this spec.
- **ALT-005**: Implement `playback@v1.getResumeUrl` capability inline. Rejected — capability addition needs its own design (plugin contracts, server lookup, deep-link format). Hero v1 falls back to nav-to-detail.
- **ALT-006**: Reorder PRs to land MediaService extensions (PR 3) before shared wire (PR 1). Rejected — PR 3 is type-independent of PR 1, but conceptually wire-shape ships first to anchor the contract.

---

## 4. Dependencies

- **DEP-001**: `@ent-mcp/shared/home` — wire-format home (PR 1 reshapes).
- **DEP-002**: `apps/server/src/catalog/service.ts` — `CatalogService.getMetadata`, `getMetadataBatch`, `getDiscoverFeed`, `getRecommendations`, `getUserHistory`, `writeMetadata` (already exist).
- **DEP-003**: `apps/server/src/media/service.ts` — `MediaService.getStatusBatch`, `getDetails`, `getMetadata`, `getSimilarFeed`, `getWatchlistFeed`, `getUpcomingFeed`, `hasCapabilityProvider` (exist). New: `getContinueWatchingFeed`, `getMatchingServers` (PR 3).
- **DEP-004**: `apps/server/src/preferences/engine.ts` — `PreferenceEngine.rankCandidates` (exists). `RankedCandidate.topContributors` (exists in `preferences/types.ts`).
- **DEP-005**: `packages/plugin-sdk/src/capabilities/continue-watching.ts` — `continueWatching@v1.getContinueWatching` SDK contract (exists).
- **DEP-006**: `apps/server/src/jobs/` — `scheduled_per_row` job kind (exists, used by catalog jobs).
- **DEP-007**: `apps/server/src/api/router.ts` — Hono root router (exists).
- **DEP-008**: `apps/server/src/errors/` — `HttpError`, `errorHandler`, `requestContextMiddleware` (exists).
- **DEP-009**: `apps/server/src/plugin-runtime/capability-registry` — `capabilityRegistry.listProviders` (exists).
- **DEP-010**: `@tanstack/react-query` — already in client workspace.
- **DEP-011**: Paraglide messages — i18n keys for home rows already added in mock-phase plan (`feature-home-page-1.md`).

---

## 5. Files

- **FILE-001**: `packages/shared/src/home/enums.ts` — modified; +`MATCH_REASON_KEYS`.
- **FILE-002**: `packages/shared/src/home/types.ts` — modified; reshape `CompactMediaItem`/`HomeRowStub`/`LayoutHero`; add `MatchReason`/`Availability`/`Facets`/`SeriesContext`/`MediaDetailsExtra`/`MediaDetailsResponse`.
- **FILE-003**: `packages/shared/src/home/schemas.ts` — modified; relax rowId enum, add getDetails schema.
- **FILE-004**: `packages/shared/src/home/__tests__/schemas.test.ts` — new.
- **FILE-005**: `apps/server/src/catalog/types.ts` — modified; +`TopContributor`, `RecItem.topContributors`.
- **FILE-006**: `apps/server/src/db/schema/catalog.ts` — modified; document new `recommendation_lists.items` JSON shape.
- **FILE-007**: `apps/server/src/catalog/jobs/recommendation-build.ts` — modified; persist `topContributors` snapshot.
- **FILE-008**: `apps/server/src/catalog/service.ts` — modified; default `topContributors: []` on read for legacy rows.
- **FILE-009**: `apps/server/src/media/service.ts` — modified; +`getContinueWatchingFeed`, +`getMatchingServers`.
- **FILE-010**: `apps/server/src/media/__tests__/get-continue-watching-feed.test.ts` — new.
- **FILE-011**: `apps/server/src/media/__tests__/get-matching-servers.test.ts` — new.
- **FILE-012**: `apps/server/src/home/types.ts` — new; `RowProvider` interface, `RowContext`.
- **FILE-013**: `apps/server/src/home/cursor.ts` — new.
- **FILE-014**: `apps/server/src/home/status-batch.ts` — new.
- **FILE-015**: `apps/server/src/home/match-reason.ts` — new.
- **FILE-016**: `apps/server/src/home/enrich.ts` — new.
- **FILE-017**: `apps/server/src/home/hero.ts` — new.
- **FILE-018**: `apps/server/src/home/errors.ts` — new.
- **FILE-019**: `apps/server/src/home/orchestrator.ts` — new.
- **FILE-020**: `apps/server/src/home/layout-cache.ts` — new.
- **FILE-021**: `apps/server/src/home/jobs/layout-warm.ts` — new.
- **FILE-022**: `apps/server/src/home/rows/index.ts` — new.
- **FILE-023**: `apps/server/src/home/rows/continue-watching-active.ts` — new.
- **FILE-024**: `apps/server/src/home/rows/continue-watching-next.ts` — new.
- **FILE-025**: `apps/server/src/home/rows/because-you-watched.ts` — new.
- **FILE-026**: `apps/server/src/home/rows/recommended-for-you-tv.ts` — new.
- **FILE-027**: `apps/server/src/home/rows/recommended-for-you-movies.ts` — new.
- **FILE-028**: `apps/server/src/home/rows/your-watchlist.ts` — new.
- **FILE-029**: `apps/server/src/home/rows/upcoming-for-you.ts` — new.
- **FILE-030**: `apps/server/src/home/rows/trending-now.ts` — new.
- **FILE-031**: `apps/server/src/home/rows/new-releases.ts` — new.
- **FILE-032**: `apps/server/src/home/rows/__tests__/<row>.test.ts` — new × 9.
- **FILE-033**: `apps/server/src/home/__tests__/orchestrator.test.ts` — new.
- **FILE-034**: `apps/server/src/home/__tests__/hero.test.ts` — new.
- **FILE-035**: `apps/server/src/home/__tests__/cursor.test.ts` — new.
- **FILE-036**: `apps/server/src/home/__tests__/match-reason.test.ts` — new.
- **FILE-037**: `apps/server/src/home/__tests__/layout-cache.test.ts` — new.
- **FILE-038**: `apps/server/src/home/jobs/__tests__/layout-warm.test.ts` — new.
- **FILE-039**: `apps/server/src/db/schema/home.ts` — new; `home_layout_cache` table.
- **FILE-040**: `apps/server/src/api/procedures/home.ts` — new; Hono sub-app.
- **FILE-041**: `apps/server/src/api/procedures/__tests__/home.test.ts` — new.
- **FILE-042**: `apps/server/src/api/router.ts` — modified; +`.route("/home", homeApp)`.
- **FILE-043**: `apps/server/src/jobs/registry.ts` — modified; +`host.home.layout_warm`.
- **FILE-044**: `.fallowrc.json` — modified; +zone for `apps/server/src/home/**`.
- **FILE-045**: `apps/client/src/features/home/lib/types.ts` — modified; drop `facets.monochrome`, drop `seasons[]`, drop `MockEpisode`/`MockSeason`.
- **FILE-046**: `apps/client/src/features/home/hooks/use-home-feed.ts` — rewritten; TanStack Query.
- **FILE-047**: `apps/client/src/features/home/hooks/use-home-row.ts` — new.
- **FILE-048**: `apps/client/src/features/home/hooks/use-home-details.ts` — new.
- **FILE-049**: `apps/client/src/features/home/components/home-feed.tsx` — modified; consume row hooks.
- **FILE-050**: `apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx` — modified; nav-to-detail Play handler.
- **FILE-051**: `apps/client/src/shared/components/media-detail-modal/index.tsx` — modified; consume `useHomeDetails`.
- **FILE-052**: `apps/client/src/shared/components/media-detail-modal/modal-seasons.tsx` — modified; placeholder until request flow.
- **FILE-053**: `apps/client/src/features/home/__tests__/card.test.tsx` — modified; typed matchReason.
- **FILE-054**: `apps/client/src/features/home/__tests__/use-home-feed.test.ts` — modified; query mocking.
- **FILE-055**: `apps/client/src/features/home/lib/mock-data.ts` — DELETED.
- **FILE-056**: `apps/client/src/features/home/lib/mock-pagination.ts` — DELETED.
- **FILE-057**: `apps/client/src/features/home/hooks/use-mock-pagination.ts` — DELETED.
- **FILE-058**: `.changeset/<slug>.md` × 6 — one per PR per project rule.

---

## 6. Testing

- **TEST-001**: Each row has a colocated test file in `apps/server/src/home/rows/__tests__/<row>.test.ts`. CI guard fails the build when missing.
- **TEST-002**: Cursor codec round-trip (encode → decode → identity) in `home/__tests__/cursor.test.ts`. Reject malformed base64, malformed JSON, schema-mismatched inner.
- **TEST-003**: Match-reason resolver covers each row × each branch. `finishing_soon` boundary at progress=0.85.
- **TEST-004**: Layout-cache `schema_version` mismatch triggers cold path on read.
- **TEST-005**: Layout-cache `isFresh` boundary at 60min.
- **TEST-006**: Hero cascade returns highest-priority eligible source.
- **TEST-007**: Hero cascade returns null when all sources empty.
- **TEST-008**: Hero alternates exclude head item.
- **TEST-009**: Orchestrator `composeLayout` reads from cache when fresh.
- **TEST-010**: Orchestrator `composeLayout` falls through + writes back when cache stale.
- **TEST-011**: Orchestrator `composeRow` returns 404 on unknown rowId.
- **TEST-012**: Orchestrator `composeDetails` cold-fill round-trips through catalog (`writeMetadata` + refetch).
- **TEST-013**: Orchestrator `composeDetails` returns `details: null` + `error.code` on plugin reject.
- **TEST-014**: Each row provider partial flag propagates from underlying aggregate.
- **TEST-015**: `becauseYouWatched` row rejects `cursor=null` with `HttpError 400 "cursor_required"`.
- **TEST-016**: `recommendedForYou-*` rows filter by `mediaType` and exclude `status="available"`.
- **TEST-017**: `your-watchlist` filters strictly to `status="available"`.
- **TEST-018**: `upcoming-for-you` returns bounded single page.
- **TEST-019**: `MediaService.getContinueWatchingFeed` partial flag, all-failed throw, attempted=0 empty.
- **TEST-020**: `MediaService.getMatchingServers` returns deduped sorted server list per tmdbId.
- **TEST-021**: `host.home.layout_warm` selects active users (last 14d), composes + writes per user, idempotent.
- **TEST-022**: API `/api/home/layout` returns 401 unauthenticated, 200 authenticated.
- **TEST-023**: API `/api/home/row` returns 200 first page, 404 unknown rowId, 400 invalid cursor.
- **TEST-024**: API `/api/home/details` returns summary + details, summary-only on plugin err.
- **TEST-025**: Schema zod round-trips for `getLayout`/`getRowContent`/`getDetails`.
- **TEST-026**: Recommendation-build job persists `topContributors`.
- **TEST-027**: Catalog `getRecommendations` round-trips `topContributors` field.
- **TEST-028**: Client `useHomeFeed` shows loading state, error state, success state via mocked TanStack Query.

---

## 7. Risks & Assumptions

- **RISK-001**: `host.home.layout_warm` may overlap with hourly `host.catalog.recommendation_build` (02:00 daily) on the first run after deploy. Stagger via existing job-service jitter; both jobs are `scheduled_per_row` so per-user mutex isolates.
- **RISK-002**: `home_layout_cache` blob shape evolves. `schema_version` invalidation prevents stale-shape reads but relies on bump discipline. Document the bump trigger in `home/layout-cache.ts` comment.
- **RISK-003**: PR 6 narrows `MatchReason` union and migrates the catalog rec-list job + MCP discover tool simultaneously. If the migration misses a consumer, `string` flowing into a `MatchReason` slot becomes a runtime type error. Static analysis (Vite+ tsc) catches these in CI.
- **RISK-004**: `MediaService.getMatchingServers` walks `resolveConnections` per item; for 60-item rows this is 60× plugin lookups. Per-request memoization in PR 3 caps to one lookup per unique tmdbId.
- **RISK-005**: `becauseYouWatched` seed selection from `user_history_mirror` requires history. New users get the row dropped via eligibility check. Acceptable.
- **ASSUMPTION-001**: `RECOMMENDATION_LIST_KINDS = ["default"]` (verified `apps/server/src/catalog/types.ts:9`). Future kinds (per-genre, per-decade) are out of scope.
- **ASSUMPTION-002**: Existing PE prose path (catalog rec-build job, MCP discover tool) survives PR 1's transitional union. Narrowing in PR 6 migrates both consumers in the same PR.
- **ASSUMPTION-003**: Active-user signal — last activity in 14 days. Reuse existing `user.last_activity_at` if present, else default to all users (small installs).
- **ASSUMPTION-004**: Mock-phase i18n keys (`home_row_*`, `home_match_reason_*`) already shipped in `feature-home-page-1.md`. Backend emits keys, client resolves.
- **ASSUMPTION-005**: Pre-stable project — DB and API breaking changes accepted (per project memory). No compat shims required for `recommendation_lists.items` shape change or `CompactMediaItem.matchReason` type flip.

---

## 8. Related Specifications / Further Reading

- [Home page backend design](../docs/superpowers/specs/2026-05-05-home-page-backend-design.md)
- [Home page UI implementation](../docs/superpowers/specs/2026-05-04-home-page-implementation-design.md)
- [Home page UI implementation plan](feature-home-page-1.md)
- [Catalog service design](../docs/2026-04-27-catalog-service-design.md)
- [Preference engine design](../docs/2026-04-20-preference-engine-design.md)
- [Job service design](../docs/2026-04-20-job-service-design.md)
- [Plugin architecture design](../docs/2026-04-19-plugin-architecture-design.md)
- [SPEC.md invariants](../SPEC.md)

---
goal: Add TV season list + per-server availability to the detail modal — 5 stacked PRs (shared wire → plugin SDK methods → plugin impls → server orchestrator → client modal)
version: 1.0
date_created: 2026-05-06
last_updated: 2026-05-06
owner: Omid Astaraki
status: "Planned"
tags: [feature, backend, frontend, home, plugins, tv]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Restore TV season detail to the media-detail modal. Two-call shape: canonical season+episode list rides on the existing `home.getDetails` response (cheap, day-cached metadata); per-server episode presence comes from a new `home.getSeasonAvailability` RPC (5-min cached, plugin-aggregate). UI flips current `modal-seasons.tsx` placeholder into a live read-only accordion w/ React `<Suspense>` for the availability fetch and a local `<ErrorBoundary>` for partial-plugin-failure microcopy. Reuses the existing `RequestableSeasons` component (set `pluginConfigured={false}`) so no accordion/episode-list visuals are rebuilt. Per-season status is best-of-N across configured servers. Per-season requesting stays out of scope; this phase is availability + season list only.

Spec amendments: `docs/superpowers/specs/2026-05-05-home-page-backend-design.md` (rev 2 §Amendment 2); `docs/superpowers/specs/2026-05-04-home-page-implementation-design.md` (modal-seasons → live sub-dir); `docs/2026-04-19-plugin-architecture-design.md` (`metadata@v1.getShowSeasons`, `libraryAvailability@v1.listShowEpisodes`).

---

## 1. Requirements & Constraints

- **REQ-001**: Five PRs land in order. Each ships green CI alone; PR N depends on PR N-1. Skipping order breaks the build.
- **REQ-002**: Canonical season+episode list returned by `home.getDetails` only when `mediaType === "tv"`. Movie responses unchanged. Season fetch failure → field omitted, no error envelope (best-effort).
- **REQ-003**: `home.getSeasonAvailability(tmdbId)` aggregates `libraryAvailability@v1.listShowEpisodes` across user's connections. Per-plugin failure surfaces in `errors[]` (serverId + classified code) alongside successful `servers[]`. Empty `servers: []` when user has no `libraryAvailability@v1` provider configured (⊥ throw).
- **REQ-004**: `metadata@v1.getShowSeasons({ id })` is global-strategy `primary_with_enrichment`, day-cached. TMDB plugin owns the impl.
- **REQ-005**: `libraryAvailability@v1.listShowEpisodes({ id, idType })` is user-scope aggregate, 5-min-cached (capability default). Plex + Jellyfin both ship impls.
- **REQ-006**: Wire shape carries flat episode presence (`{ season, episode }[]`); host buckets to seasons map. Plugin = pure pass-through.
- **REQ-007**: Specials filter (`seasonNumber === 0`) is purely client-side: rendered only when ≥1 server has ≥1 episode. Pure-canonical specials hidden.
- **REQ-008**: Per-season status derived best-of-N across servers: `available` (any server has all eps), `partial` (any server has some, none has all), `unavailable` (all zero or no servers), `upcoming` (`airDate > now()` AND no presence anywhere).
- **REQ-009**: `modal-seasons/` sub-dir per `CLAUDE.md` decomposition rule (memory #17). Files: `index.tsx`, `seasons-list.tsx`, `use-season-availability.ts`, `derive-status.ts`, `seasons-error.tsx`. Tests colocated.
- **REQ-010**: Availability fetch uses `useSuspenseQuery` (TanStack Query). `<Suspense>` boundary scoped to seasons accordion only — modal body renders details immediately. `<ErrorBoundary>` sibling renders partial-failure microcopy.
- **REQ-011**: `RequestableSeasons` (existing component at `apps/client/src/features/request-flow/components/requestable-seasons.tsx`) is reused unmodified. Adapter joins canonical `SeasonInfo[]` × `SeasonAvailabilityServer[]` → component's expected `Season[]` shape. `pluginConfigured={false}` flips action UI to plain `RequestStatusBadge`.
- **CON-001**: Pre-stable project — wire format and plugin SDK additions ship without compat shims (per project memory).
- **CON-002**: Use Vite+ for all runs (`vp install`, `vp check`, `vp test`).
- **CON-003**: Each PR ships a `.changeset/<slug>.md` per project rule (1-2 sentences, end-user voice, past tense).
- **CON-004**: Tests colocate in `__tests__/` directories next to the file under test.
- **GUD-001**: Files exceeding ~150 lines or handling 3+ concerns split into a sub-directory with named files per concern.
- **PAT-001**: New plugin SDK method names mirror existing pluralised pattern (`listRecentlyAdded`, `listAvailable`, `listShowEpisodes`).

---

## 2. Implementation Steps

### Phase 1 — PR `seasons-shared-wire`

- GOAL-001: Add `SeasonInfo`, `SeasonEpisodeInfo`, `SeasonAvailabilityServer`, `SeasonAvailabilityError`, `SeasonAvailabilityResponse` types to `@ent-mcp/shared/home`. Extend `MediaDetailsExtra` with optional `seasons?: SeasonInfo[]`. Add `homeGetSeasonAvailabilityInputSchema`. Type-only PR; no runtime change.

| Task     | Description                                                                                                                                                                                                                                                                           | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-001 | Edit `packages/shared/src/home/types.ts` — add `SeasonEpisodeInfo` (`{ episodeNumber, title, airDate?, runtime? }`), `SeasonInfo` (`{ seasonNumber, name, airDate?, totalEpisodes, episodes }`), `SeasonAvailabilityServer`, `SeasonAvailabilityError`, `SeasonAvailabilityResponse`. |           |      |
| TASK-002 | Edit `packages/shared/src/home/types.ts` — extend `MediaDetailsExtra` with `seasons?: SeasonInfo[]`. Add JSDoc clarifying tv-only + best-effort semantics.                                                                                                                            |           |      |
| TASK-003 | Edit `packages/shared/src/home/schemas.ts` — add `homeGetSeasonAvailabilityInputSchema = z.object({ tmdbId: z.string().min(1) }).strict()`. Export derived input type.                                                                                                                |           |      |
| TASK-004 | Edit `packages/shared/src/home/__tests__/schemas.test.ts` — round-trip `homeGetSeasonAvailabilityInputSchema`; reject empty tmdbId, extra props.                                                                                                                                      |           |      |
| TASK-005 | Run `vp check` and `vp test` — verify no compile errors in any consumer (existing `MediaDetailsExtra` consumers see optional new field; safe).                                                                                                                                        |           |      |
| TASK-006 | Write `.changeset/seasons-shared-wire.md` — empty frontmatter (internal-only; no user-facing surface yet).                                                                                                                                                                            |           |      |

### Phase 2 — PR `seasons-plugin-sdk`

- GOAL-002: Add `metadata@v1.getShowSeasons` and `libraryAvailability@v1.listShowEpisodes` SDK method definitions. SDK-only PR — no plugin impl, no host wiring. Existing plugins continue to load (loader allows missing-method = capability not declared / not invokable; verify in test).

| Task     | Description                                                                                                                                                                                                                                                                                                                                                 | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-007 | Edit `packages/plugin-sdk/src/capabilities/metadata.ts` — add `getShowSeasons` method definition. Input: `z.object({ id: z.string() })`. Output: `z.object({ seasons: z.array(seasonInfoShape) })`. Define `seasonInfoShape` zod object mirroring shared `SeasonInfo` (use field-by-field zod, not `z.infer`).                                              |           |      |
| TASK-008 | Edit `packages/plugin-sdk/src/capabilities/library-availability.ts` — add `listShowEpisodes` method definition. Input: `z.object({ id: z.string().min(1), idType: libraryAvailabilityIdType })`. Output: `z.object({ episodes: z.array(z.object({ season: z.number(), episode: z.number() })) })`.                                                          |           |      |
| TASK-009 | Edit `packages/plugin-sdk/src/capabilities/__tests__/metadata.test.ts` — verify `MetadataV1.methods.getShowSeasons` exists, input/output schemas validate sample payloads.                                                                                                                                                                                  |           |      |
| TASK-010 | Edit `packages/plugin-sdk/src/capabilities/__tests__/library-availability.test.ts` — verify `LibraryAvailabilityV1.methods.listShowEpisodes` exists, input/output schemas validate sample payloads.                                                                                                                                                         |           |      |
| TASK-011 | Verify plugin loader does not reject existing plugins for missing-method on `getShowSeasons`/`listShowEpisodes`. Capability discipline rule (`docs/2026-04-19-plugin-architecture-design.md`) is "plugin declaring capability ⊥ skip method" — TMDB declares `metadata@v1` so it must implement `getShowSeasons` in PR 3; same for Plex/Jellyfin + library. |           |      |
| TASK-012 | Run `vp check` and `vp test`.                                                                                                                                                                                                                                                                                                                               |           |      |
| TASK-013 | Write `.changeset/seasons-plugin-sdk.md` — empty frontmatter (internal-only; consumers in PR 3).                                                                                                                                                                                                                                                            |           |      |

### Phase 3 — PR `seasons-plugin-impls`

- GOAL-003: TMDB plugin implements `getShowSeasons`. Plex + Jellyfin plugins implement `listShowEpisodes`. Per-plugin tests added. Loader passes once impls land alongside SDK methods from PR 2.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-014 | Edit `packages/plugins/tmdb/src/capabilities/metadata.ts` — add `getShowSeasons({ id })`. Issue `GET /tv/{id}` with `append_to_response=season/1,season/2,…,season/N` (build chunked appends if season count exceeds TMDB URL length budget). Map TMDB `seasons[].season_number/name/air_date/episode_count` + each `season/N.episodes[]` payload (`episode_number/name/air_date/runtime`) into shared `SeasonInfo[]`. Skip seasons with `season_number == null`.                                              |           |      |
| TASK-015 | Edit `packages/plugins/tmdb/src/mappers.ts` — helpers `toSeasonInfo`, `toSeasonEpisodeInfo`. ISO date pass-through; runtime in minutes (TMDB native).                                                                                                                                                                                                                                                                                                                                                          |           |      |
| TASK-016 | Write `packages/plugins/tmdb/__tests__/get-show-seasons.test.ts` — fixture-based tests against canned TMDB responses: full-show round trip, missing `air_date` on unaired season, empty `episodes` for season 0 specials, season-number=null filter.                                                                                                                                                                                                                                                           |           |      |
| TASK-017 | Edit `packages/plugins/plex/src/capabilities/library-availability.ts` — add `listShowEpisodes({ id, idType })`. If `idType === "plex"` (server-local ratingKey), call `GET /library/metadata/{id}/allLeaves` directly. Else resolve via plugin's own `idResolve@v1` (already implements `tmdb`/`imdb`/`tvdb` → `plex:ratingKey`) then call `allLeaves`. Map response `Metadata[].parentIndex/index` → `{ season, episode }`. Skip rows missing either field. Empty list if title not in library (404 → empty). |           |      |
| TASK-018 | Write `packages/plugins/plex/__tests__/list-show-episodes.test.ts` — fixture: cross-server `tmdb` id resolves + enumerates; server-local `plex` id direct path; 404 → `{ episodes: [] }`; missing parentIndex filtered.                                                                                                                                                                                                                                                                                        |           |      |
| TASK-019 | Edit `packages/plugins/jellyfin/src/capabilities/library-availability.ts` — add `listShowEpisodes({ id, idType })`. If `idType === "jellyfin"` direct call `GET /Shows/{id}/Episodes?Fields=ParentIndexNumber,IndexNumber`. Else resolve via plugin's own `idResolve@v1` to `jellyfin:itemId` then call same. Map `Items[].ParentIndexNumber/IndexNumber` → `{ season, episode }`. 404/empty → `{ episodes: [] }`.                                                                                             |           |      |
| TASK-020 | Write `packages/plugins/jellyfin/__tests__/list-show-episodes.test.ts` — mirror Plex tests; verify `ParentIndexNumber`/`IndexNumber` mapping, missing-field filter, cross-server resolve happy path.                                                                                                                                                                                                                                                                                                           |           |      |
| TASK-021 | Run `vp check` and `vp test` across `packages/plugins/tmdb`, `packages/plugins/plex`, `packages/plugins/jellyfin`.                                                                                                                                                                                                                                                                                                                                                                                             |           |      |
| TASK-022 | Write `.changeset/seasons-plugin-impls.md` — `@ent-mcp/plugin-tmdb` minor, `@ent-mcp/plugin-plex` minor, `@ent-mcp/plugin-jellyfin` minor: "Plugins now report TV season metadata and per-server episode presence."                                                                                                                                                                                                                                                                                            |           |      |

### Phase 4 — PR `seasons-server-orchestrator`

- GOAL-004: `MediaService.getShowSeasons` typed wrapper. New `composeSeasonAvailability` orchestrator path. Extend `composeDetails` to append `seasons` for tv requests. Register `/api/home/season-availability` Hono route. Tests for orchestrator + route.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                    | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-023 | Edit `apps/server/src/media/service.ts` — add `getShowSeasons(tmdbId: string): Promise<SeasonInfo[] \| null>`. Wraps `dispatch({ capability: "metadata", version: "v1", method: "getShowSeasons", input: { id: tmdbId } })`. Lifts `seasons` array from result; returns `null` on plugin reject (caller decides whether to omit field).                                        |           |      |
| TASK-024 | Write `apps/server/src/media/__tests__/get-show-seasons.test.ts` — primary plugin success returns array, plugin reject returns null, malformed payload (missing `seasons`) returns null.                                                                                                                                                                                       |           |      |
| TASK-025 | Write `apps/server/src/home/season-availability.ts` — `composeSeasonAvailability(ctx, tmdbId)` per spec §Amendment 2. Resolves connections for `libraryAvailability@v1`, dispatches `listShowEpisodes` via `Promise.allSettled`, buckets episodes by season, accumulates `errors[]` for rejections. Returns `{ servers, errors? }`. Empty servers when no provider configured. |           |      |
| TASK-026 | Edit `apps/server/src/home/orchestrator.ts:composeDetails` — after the existing `Promise.all` for details + summary, when `mediaType === "tv"` await `mediaService.getShowSeasons(tmdbId)` (settled). On success, append `seasons` to `MediaDetailsExtra` returned. On reject/null, omit the field — don't fail the whole call.                                                |           |      |
| TASK-027 | Edit `apps/server/src/api/procedures/home.ts` — add `GET /season-availability` route with `zValidator("query", homeGetSeasonAvailabilityInputSchema)`. Calls `composeSeasonAvailability(ctx, tmdbId)`. Returns 200 with `SeasonAvailabilityResponse`.                                                                                                                          |           |      |
| TASK-028 | Write `apps/server/src/home/__tests__/season-availability.test.ts` — empty providers → `{ servers: [] }`; mixed success+reject → `errors[]` populated, `servers[]` populated; per-server bucketing groups flat episodes correctly; sorts `episodesPresent` ascending.                                                                                                          |           |      |
| TASK-029 | Edit `apps/server/src/home/__tests__/orchestrator.test.ts` — add tests for `composeDetails` tv path: appends `seasons` on success; omits on `getShowSeasons` reject; movie path unchanged.                                                                                                                                                                                     |           |      |
| TASK-030 | Edit `apps/server/src/api/procedures/__tests__/home.test.ts` — `GET /api/home/season-availability` returns 200 with shape; 401 unauthenticated; 400 missing tmdbId; partial-failure surface in JSON.                                                                                                                                                                           |           |      |
| TASK-031 | Run `vp check` and `vp test`.                                                                                                                                                                                                                                                                                                                                                  |           |      |
| TASK-032 | Write `.changeset/seasons-server-orchestrator.md` — `@ent-mcp/server` minor: "Detail responses now include TV season info and a new endpoint reports per-server episode availability."                                                                                                                                                                                         |           |      |

### Phase 5 — PR `seasons-client-modal`

- GOAL-005: Replace `modal-seasons.tsx` placeholder with live sub-dir. Suspense + ErrorBoundary. Reuse `RequestableSeasons` w/ `pluginConfigured={false}`. Best-of-N status reducer. Specials hidden when no server presence.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-033 | Delete `apps/client/src/shared/components/media-detail-modal/modal-seasons.tsx`. Will be replaced by `modal-seasons/` sub-dir.                                                                                                                                                                                                                                                                                                                                                                           |           |      |
| TASK-034 | Create `apps/client/src/shared/components/media-detail-modal/modal-seasons/index.tsx` — exports `ModalSeasons`. Returns `null` for movies. Wraps content in `<Suspense fallback={<SeasonsSkeleton />}>` and `<ErrorBoundary fallback={<SeasonsError />}>`. Renders header + delegates body to `<SeasonsList />`.                                                                                                                                                                                         |           |      |
| TASK-035 | Create `apps/client/src/shared/components/media-detail-modal/modal-seasons/use-season-availability.ts` — `useSuspenseQuery` against `GET /api/home/season-availability?tmdbId=`. 5-minute `staleTime`. Returns `SeasonAvailabilityResponse`.                                                                                                                                                                                                                                                             |           |      |
| TASK-036 | Create `apps/client/src/shared/components/media-detail-modal/modal-seasons/derive-status.ts` — `deriveSeasonStatus(season: SeasonInfo, servers: SeasonAvailabilityServer[]): "available" \| "partial" \| "unavailable" \| "upcoming"`. Best-of-N rules per spec. Plus `joinSeasonAvailability(canonical: SeasonInfo[], servers: SeasonAvailabilityServer[]): Season[]` adapter producing the shape `RequestableSeasons` expects (status, episode list, counts.available reduced from best-of-N server).  |           |      |
| TASK-037 | Create `apps/client/src/shared/components/media-detail-modal/modal-seasons/seasons-list.tsx` — receives `seasons: SeasonInfo[]` from `MediaDetailItem`, calls `useSeasonAvailability`, joins via `joinSeasonAvailability`, filters specials w/ no presence, renders `<RequestableSeasons seasons={joined} pluginConfigured={false} role="user" itemId={tmdbId} itemTitle={title} />`. Falls back to canonical-only render when `servers.length === 0` AND `errors.length === 0` (no servers configured). |           |      |
| TASK-038 | Create `apps/client/src/shared/components/media-detail-modal/modal-seasons/seasons-error.tsx` — `<ErrorBoundary>` fallback. Renders single-line microcopy "Couldn't load library availability" with retry hint. Used when `home.getSeasonAvailability` itself rejects (network/500). Per-plugin failures arrive in `errors[]` and render inline alongside successful servers (not a boundary trigger).                                                                                                   |           |      |
| TASK-039 | Edit `apps/client/src/shared/components/media-detail-modal/index.tsx` — swap the `<ModalSeasons item={item} />` import to point at the new sub-dir's `index.tsx`. The component continues to receive the same `item` prop; internally it now reads `item.seasons` and triggers the availability fetch.                                                                                                                                                                                                   |           |      |
| TASK-040 | Edit `apps/client/src/shared/components/media-detail-modal/types.ts` — `MediaDetailItem` already inherits `Partial<MediaDetailsExtra>`, so the new `seasons?: SeasonInfo[]` field flows through without further change. Verify no consumers break.                                                                                                                                                                                                                                                       |           |      |
| TASK-041 | Add Paraglide message keys for the seasons section: `home_detail_seasons_label` (already exists, retain), `home_detail_seasons_loading` ("Checking your servers..."), `home_detail_seasons_error` ("Couldn't load library availability"), `home_detail_seasons_no_servers` ("No connected library servers"), `home_detail_seasons_server_unreachable` ("{server} unreachable"). Add to `apps/client/src/paraglide/messages/<locale>.json` for default locale.                                            |           |      |
| TASK-042 | Write `apps/client/src/shared/components/media-detail-modal/modal-seasons/__tests__/derive-status.test.ts` — best-of-N rules: all available → `available`, partial on one server → `partial`, all-zero → `unavailable`, future airDate + zero presence → `upcoming`. Specials filter when no presence.                                                                                                                                                                                                   |           |      |
| TASK-043 | Write `apps/client/src/shared/components/media-detail-modal/modal-seasons/__tests__/seasons-list.test.tsx` — renders accordion when `seasons` + `servers` present; falls back to canonical-only when no servers configured; shows error microcopy on `useSuspenseQuery` reject; renders partial-failure row alongside successful servers.                                                                                                                                                                |           |      |
| TASK-044 | Manual smoke: start `vp dev`, open TV detail modal for a show on the user's Plex/Jellyfin connection. Verify: details render immediately; seasons section shows skeleton briefly; per-season chips populate; specials hidden when no server presence; partial-failure shows microcopy when one plugin times out (simulate via short timeout).                                                                                                                                                            |           |      |
| TASK-045 | Run `vp check` and `vp test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |           |      |
| TASK-046 | Write `.changeset/seasons-client-modal.md` — `@ent-mcp/client` minor: "Restored the season list to TV detail with per-server availability."                                                                                                                                                                                                                                                                                                                                                              |           |      |

---

## 3. Alternatives

- **ALT-001**: Single endpoint extending `home.getDetails` to include both canonical seasons AND per-server availability. Rejected — different freshness profiles (day vs minutes), couples plugin failure to detail call, bloats movie payloads conditionally, single TTL fits neither side.
- **ALT-002**: All-lazy single new endpoint `home.getSeasons(tmdbId)` aggregating canonical + availability server-side. Rejected — gates cheap canonical seasons behind a second round trip, can't reuse the warm metadata cache from the details call, single TTL again wrong for both halves.
- **ALT-003**: Build a brand-new pure-availability accordion component instead of reusing `RequestableSeasons`. Rejected — duplicates collapsible/episode-row/subline UI; prior mock-phase shipped this layout already, sidestepping it loses parity.
- **ALT-004**: Plugin SDK returns pre-bucketed `{ seasons: [{ seasonNumber, episodesPresent: [] }] }` directly. Rejected — bucketing logic in two plugins is duplicated; plugins return what their HTTP endpoints already produce (flat list); host owns the one bucket implementation.
- **ALT-005**: Block modal render until availability resolves (single suspense for entire modal). Rejected — TTFB pessimisation. Suspense scoped to seasons accordion only; rest of modal renders immediately.
- **ALT-006**: TanStack Query `useQuery` with manual loading state instead of `useSuspenseQuery`. Rejected — Suspense+ErrorBoundary composition is cleaner for this concentrated boundary; manual loading state would require state-tree threading.
- **ALT-007**: Add a `host.home.season_availability_warm` job to pre-compute. Rejected — combinatorial: every TV title × every user × every server. Bounded only when user opens detail; lazy fetch is correct shape.

---

## 4. Dependencies

- **DEP-001**: `@ent-mcp/shared/home` — wire-format home (PR 1 extends).
- **DEP-002**: `packages/plugin-sdk` — `metadata@v1` and `libraryAvailability@v1` capability definitions (PR 2 extends).
- **DEP-003**: `packages/plugins/tmdb/src/capabilities/metadata.ts` — TMDB metadata impl (PR 3 adds `getShowSeasons`).
- **DEP-004**: `packages/plugins/plex/src/capabilities/library-availability.ts` — Plex `library@v1` impl (PR 3 adds `listShowEpisodes`).
- **DEP-005**: `packages/plugins/jellyfin/src/capabilities/library-availability.ts` — Jellyfin `library@v1` impl (PR 3 adds `listShowEpisodes`).
- **DEP-006**: `apps/server/src/media/service.ts` — `MediaService.dispatch`/`resolveConnections` (already exist).
- **DEP-007**: `apps/server/src/home/orchestrator.ts` — `composeDetails` (PR 4 extends).
- **DEP-008**: `apps/server/src/api/procedures/home.ts` — Hono sub-app (PR 4 adds route).
- **DEP-009**: `apps/client/src/features/request-flow/components/requestable-seasons.tsx` — existing accordion component (reused unchanged in PR 5; props `seasons: Season[]`, `pluginConfigured: boolean` already supported).
- **DEP-010**: `@tanstack/react-query` — `useSuspenseQuery` (already in client workspace).
- **DEP-011**: React error boundary primitive — existing `<ErrorBoundary>` shared component (verify location during PR 5; if missing, use `react-error-boundary` already in deps).

---

## 5. Files

- **FILE-001**: `packages/shared/src/home/types.ts` — modified; +`SeasonInfo`, `SeasonEpisodeInfo`, `SeasonAvailabilityServer`, `SeasonAvailabilityError`, `SeasonAvailabilityResponse`; `MediaDetailsExtra` +`seasons?`.
- **FILE-002**: `packages/shared/src/home/schemas.ts` — modified; +`homeGetSeasonAvailabilityInputSchema`.
- **FILE-003**: `packages/shared/src/home/__tests__/schemas.test.ts` — modified; +season-availability schema round-trip.
- **FILE-004**: `packages/plugin-sdk/src/capabilities/metadata.ts` — modified; +`getShowSeasons`.
- **FILE-005**: `packages/plugin-sdk/src/capabilities/library-availability.ts` — modified; +`listShowEpisodes`.
- **FILE-006**: `packages/plugin-sdk/src/capabilities/__tests__/metadata.test.ts` — modified; +method assertions.
- **FILE-007**: `packages/plugin-sdk/src/capabilities/__tests__/library-availability.test.ts` — modified; +method assertions.
- **FILE-008**: `packages/plugins/tmdb/src/capabilities/metadata.ts` — modified; +`getShowSeasons` impl.
- **FILE-009**: `packages/plugins/tmdb/src/mappers.ts` — modified; +`toSeasonInfo`/`toSeasonEpisodeInfo`.
- **FILE-010**: `packages/plugins/tmdb/__tests__/get-show-seasons.test.ts` — new.
- **FILE-011**: `packages/plugins/plex/src/capabilities/library-availability.ts` — modified; +`listShowEpisodes` impl.
- **FILE-012**: `packages/plugins/plex/__tests__/list-show-episodes.test.ts` — new.
- **FILE-013**: `packages/plugins/jellyfin/src/capabilities/library-availability.ts` — modified; +`listShowEpisodes` impl.
- **FILE-014**: `packages/plugins/jellyfin/__tests__/list-show-episodes.test.ts` — new.
- **FILE-015**: `apps/server/src/media/service.ts` — modified; +`getShowSeasons`.
- **FILE-016**: `apps/server/src/media/__tests__/get-show-seasons.test.ts` — new.
- **FILE-017**: `apps/server/src/home/season-availability.ts` — new; `composeSeasonAvailability`.
- **FILE-018**: `apps/server/src/home/__tests__/season-availability.test.ts` — new.
- **FILE-019**: `apps/server/src/home/orchestrator.ts` — modified; `composeDetails` appends `seasons` for tv.
- **FILE-020**: `apps/server/src/home/__tests__/orchestrator.test.ts` — modified; +tv-path assertions.
- **FILE-021**: `apps/server/src/api/procedures/home.ts` — modified; +`GET /season-availability` route.
- **FILE-022**: `apps/server/src/api/procedures/__tests__/home.test.ts` — modified; +season-availability route tests.
- **FILE-023**: `apps/client/src/shared/components/media-detail-modal/modal-seasons.tsx` — DELETED.
- **FILE-024**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/index.tsx` — new.
- **FILE-025**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/seasons-list.tsx` — new.
- **FILE-026**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/use-season-availability.ts` — new.
- **FILE-027**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/derive-status.ts` — new.
- **FILE-028**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/seasons-error.tsx` — new.
- **FILE-029**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/__tests__/derive-status.test.ts` — new.
- **FILE-030**: `apps/client/src/shared/components/media-detail-modal/modal-seasons/__tests__/seasons-list.test.tsx` — new.
- **FILE-031**: `apps/client/src/shared/components/media-detail-modal/index.tsx` — modified; import path swap to sub-dir.
- **FILE-032**: `apps/client/src/paraglide/messages/<locale>.json` — modified; +season-loading/error/no-servers/server-unreachable keys.
- **FILE-033**: `.changeset/<slug>.md` × 5 — one per PR per project rule.

---

## 6. Testing

- **TEST-001**: Schema zod round-trip for `homeGetSeasonAvailabilityInputSchema`. Reject empty tmdbId, extra props.
- **TEST-002**: `metadata@v1.getShowSeasons` SDK method input/output schemas validate sample payloads.
- **TEST-003**: `libraryAvailability@v1.listShowEpisodes` SDK method input/output schemas validate sample payloads.
- **TEST-004**: TMDB `getShowSeasons` — full-show round trip; missing `air_date` on unaired season; specials season 0; season-number=null filter.
- **TEST-005**: Plex `listShowEpisodes` — server-local id direct path; cross-server id resolves via `idResolve@v1`; 404 → empty; missing `parentIndex`/`index` filtered.
- **TEST-006**: Jellyfin `listShowEpisodes` — `ParentIndexNumber`/`IndexNumber` mapping; missing-field filter; cross-server resolve happy path.
- **TEST-007**: `MediaService.getShowSeasons` — primary plugin success returns array; reject returns null; malformed payload returns null.
- **TEST-008**: `composeSeasonAvailability` — empty providers → `{ servers: [] }`; mixed success+reject → `errors[]` populated alongside `servers[]`; bucketing groups flat episodes; sorts `episodesPresent` ascending.
- **TEST-009**: Orchestrator `composeDetails` tv path appends `seasons` on success; omits on `getShowSeasons` reject; movie path unchanged (no `seasons` field).
- **TEST-010**: `GET /api/home/season-availability` — 200 with response shape; 401 unauthenticated; 400 missing tmdbId; partial-failure surface in JSON envelope.
- **TEST-011**: Client `deriveSeasonStatus` best-of-N rules: all available → `available`; partial on any → `partial`; all zero → `unavailable`; future airDate + zero presence → `upcoming`.
- **TEST-012**: Client `joinSeasonAvailability` produces `Season[]` matching `RequestableSeasons` expected shape; specials filtered when no presence.
- **TEST-013**: `<SeasonsList>` renders accordion when `seasons` + `servers` present; falls back to canonical-only when no servers configured; shows error microcopy on `useSuspenseQuery` reject; renders partial-failure row alongside successful servers.
- **TEST-014**: Manual smoke (PR 5): real Plex/Jellyfin connection, TV detail modal opens, seasons accordion populates correctly, partial-failure microcopy renders on simulated plugin timeout.

---

## 7. Risks & Assumptions

- **RISK-001**: TMDB `append_to_response=season/N` URL length budget. Long-running shows (>20 seasons) may exceed; mitigation in TMDB plugin via chunked appends. Defer chunking until observed.
- **RISK-002**: Plex `allLeaves` and Jellyfin `/Shows/{id}/Episodes` return the entire episode list in one HTTP body. For 250-episode shows that's ~50KB per server. Acceptable; capability is 5-min cached so repeat opens hit cache.
- **RISK-003**: Plugin enumeration cost grows linearly with library size. User w/ Plex + Jellyfin both connected = 2 HTTP calls per modal-open (uncached). 5-min TTL absorbs repeat opens. No additional caching layer added v1; revisit if metrics show pressure.
- **RISK-004**: `RequestableSeasons` was built around request-flow concepts (`RequestStatus` enum, action handlers). Reusing with `pluginConfigured={false}` flips action UI to plain badge but keeps the status enum surface. Adapter (`joinSeasonAvailability`) maps best-of-N status to closest enum value (`available`/`partial`/`unavailable`/`upcoming`); `requested`/`pending`/`in-progress` never emitted in this phase. Component split into pure-display variant deferred until request flow lands and shape stabilises.
- **RISK-005**: Suspense + ErrorBoundary placement — must scope tightly to seasons accordion. A misplaced boundary would block the whole modal on availability fetch failure. Test TASK-044 manual smoke verifies.
- **ASSUMPTION-001**: `metadata@v1.defaultCacheTtlSec = DAY` (already configured in SDK) is the correct TTL for canonical seasons. TMDB seasons are stable; day cache is appropriate.
- **ASSUMPTION-002**: `libraryAvailability@v1.defaultCacheTtlSec = 5 * MIN` (already configured) is the correct TTL for episode presence. User adding episode sees update within 5 min. Acceptable for v1.
- **ASSUMPTION-003**: TMDB plugin has `season/N` append support per current TMDB API v3. Verified at `https://developer.themoviedb.org/reference/tv-series-details`.
- **ASSUMPTION-004**: Plex `idResolve@v1` and Jellyfin `idResolve@v1` already translate `tmdb`/`imdb`/`tvdb` to server-local ids (per `docs/2026-04-19-plugin-architecture-design.md`). PR 3 plugin impls assume these are live.
- **ASSUMPTION-005**: Pre-stable project — wire format and SDK additions ship without compat shims (per project memory).

---

## 8. Related Specifications / Further Reading

- [Home page backend design (rev 2 §Amendment 2)](../docs/superpowers/specs/2026-05-05-home-page-backend-design.md)
- [Home page UI implementation](../docs/superpowers/specs/2026-05-04-home-page-implementation-design.md)
- [Home page backend implementation plan](feature-home-page-backend-1.md)
- [Plugin architecture design](../docs/2026-04-19-plugin-architecture-design.md)
- [SPEC.md invariants](../SPEC.md)

# PRD: Media Resource Unification

> **Source of truth:** [`docs/2026-05-30-media-resource-unification-design.md`](../docs/2026-05-30-media-resource-unification-design.md) (rev 1).
> This PRD repackages that design into implementable, independently-verifiable user stories for the Ralph autonomous loop. The design document governs all contract details; where this PRD and the design disagree, the design wins. Section references (§A1, §B2, …) and invariant/risk tags (V.RG1, RISK-205, …) point into that design.
>
> **Extends:** [`docs/2026-05-26-media-pipeline-consolidation-design.md`](../docs/2026-05-26-media-pipeline-consolidation-design.md) — the shipped server read-pipeline consolidation (commit `dacd3825`). That work unified the _internal_ read path; this work unifies the _HTTP surface_ and its _client mirror_.
>
> **Epic:** [#491](https://github.com/electather/nama/issues/491) — frontend half. Realizes the deferred §I endpoint collapse and folds in #504–#519 (open; #517/#518 already closed).

## Introduction

The pipeline consolidation made `media.listRows(source, cfg)` the single server read path, but it stopped one layer too deep: the HTTP **surface** still forks per product (`api/procedures/home.ts` + `api/procedures/watchlist.ts` — two hand-written procedure files doing the same job, serving the same pipeline), there is **no shared `sourceId` contract** (source ids are inline strings scattered across `home/rows/index.ts` and `watchlist/sources/*`), the **cursor codec is server-only** (so the client cannot build the `similarTo` seed cursor — the open gap from consolidation §H), and the **client duplicates the product split badly** (two fetchers, two error classes, two query-key roots, two near-identical infinite-list hooks, two card assemblies over the same primitives).

This project unifies the wire and its client mirror. On the server it adds **one media resource surface** — `GET /api/media/sources/:sourceId` (a generic, registry-dispatched resolver for every paginated read) plus dedicated title / counts / moods / writes endpoints — implemented as a **new `api/` adapter** that composes the _existing_ `home` / `watchlist` / `media` module barrels. On the wire it extends `@nama/shared/media` with the one source-id set, the relocated cursor codec, the per-source param schemas, and the canonical `Page` shape. On the client it adds one `shared/media/` layer (one list-hook core, one query-key root, one error class, shared card/skeleton primitives) and reduces `home` and `watchlist` to thin shells consuming `api.media.*`.

**This is an adapter + wire-contract + client change. There is no server module re-org** (§A1, invariant V.A1): no composition logic moves between `home`, `watchlist`, and `media`. The URL reflects the _resource_; the owning module reflects the _logic_; the adapter bridges them. Apart from what the adjacent tracks (#511–#519) explicitly specify, there is **no user-visible behavior change** — read parity is the success bar.

## Goals

- Establish one media wire surface: `/api/media/*` — a generic source resolver for every paginated read plus dedicated title / counts / moods / writes endpoints, served by a single `api/procedures/media.ts` adapter. One `api.media.*` client.
- Establish one shared wire contract in `@nama/shared/media`: a `MEDIA_SOURCE_IDS` as-const tuple, the cursor codec (relocated from the server `media` module), per-source param zod schemas, and the canonical `Page` shape. Close the `similarTo` cursor gap by sharing one codec across client and server.
- Establish one client media layer (`apps/client/src/shared/media/`): one list-hook core (suspense + lazy wrappers), one query-key root, one `MediaApiError`, and shared row-card / grid-skeleton / empty-state primitives. `home` and `watchlist` become thin shells.
- Preserve module ownership exactly: no composition logic moves between `home`, `watchlist`, and `media` (invariant V.A1). `media` never imports concrete sources (invariant V.RG1) — the source registry lives in the `api/` adapter, composed from consumer barrels.
- Sequence additively: add `/api/media/*` first, migrate the client onto it, then delete the old surface in a final cutover — no compat shim (pre-stable clean break).
- Fold in the adjacent tracks: watchlist route loaders (#513), Paraglide ICU variants (#511/#512), and all-items virtual scroll (#519), plus the correctness nits (#514/#515/#516).

## User Stories

Each story is one phase from design §D and maps to **one PR** that must end with `vp check` and `vp test` green. Stories are ordered. Part A (US-001…US-005) is **additive** — it adds `/api/media/*` without removing the old endpoints — and can land and sit before Part B starts. Part B (US-006…US-012) migrates the client. The old surface is deleted only in the final cutover (US-013). "Parity" criteria assert no behavior change; capture fixtures from the pre-refactor endpoints where noted. Compact context at each phase boundary.

> **Changeset rule (project):** `@nama/shared` is internal-only and is **never** listed in a changeset — its changes ride the consumer (`@nama/server` / `@nama/client`) bump. Additive server phases that add a dormant surface nothing consumes yet are **internal** (empty-frontmatter changeset); the user-facing `minor` bump lands at the phases that actually change observable behavior (US-010, US-012, US-013).

---

### Part A — Media Resource API (server adapter + wire); additive

### US-001: Extend `@nama/shared/media` with the wire contract

**Description:** As a developer, I want one shared media wire contract — source-id set, cursor codec, param schemas, and page shape — so that client and server agree on exactly one definition of each (§A5).

**Acceptance Criteria:**

- [ ] `@nama/shared/media` (existing subpath at `packages/shared/src/media/`) gains a `MEDIA_SOURCE_IDS` **as-const tuple** plus the derived `MediaSourceId` type. Values lift the existing slugs: `recommendedForYou-tv`, `recommendedForYou-movies`, `continueWatching-active`, `continueWatching-next`, `becauseYouWatched`, `similarTo`, `yourWatchlist`, `upcomingForYou`, `trendingNow`, `newReleases`, `watchlist-items`, `watchlist-mood-items`, `watchlist-tonight`, `watchlist-recently`. Watchlist buckets ride `watchlist-items` via a `bucket` **param**, NOT per-bucket ids.
- [ ] New exports land **alongside** the existing recommendation-engine `MediaItem` / `ActiveRow` / `RowSort` / `RowFilter` — names do NOT collide and `MediaItem` is NOT touched (consolidation §D: "`MediaItem` is already taken… do not reuse it").
- [ ] The cursor codec is **moved here**: the `Cursor` type, `encode`, `decode(raw, expectedMode?)`, and the `encodeSeedCursor` helper. `decode` returns `Cursor | null` and never throws (invariant V.CU1).
- [ ] `decodeSeedToken` and `SeedToken` (home's similar-feed `offset` paging) **stay home-source-private** — they are NOT relocated (they would drag home paging across the boundary).
- [ ] The server `media` barrel **re-exports** the relocated codec so server-internal consumers that import `encode` / `Cursor` from the `media` barrel today (e.g. `home/sources/similar-paged.ts`) keep their barrel import unchanged (invariant V.RG1 untouched). `media/cursor.ts` becomes a thin re-export of the shared codec.
- [ ] Per-source param zod schemas exist (discriminated per source): `watchlist-items` (`{ bucket?, sort, mood?, limit, cursor? }`), `watchlist-mood-items` (`{ moodId, limit, cursor? }`), seeded home (`{ seedId, seedType }` for `similarTo`), bounded (`{ limit }`), and void. Reuse the shapes of today's `itemsQuerySchema` / `moodItemsQuerySchema`.
- [ ] `Page = { items: CompactMediaItem[]; cursor: string | null; partial: boolean }` is exported as the canonical page shape.
- [ ] `CompactMediaItem` is **re-exported** from `@nama/shared/media` (its definition stays in `@nama/shared/home` to avoid a churn cascade); `MediaDetailsResponse`, `SeasonAvailabilityResponse`, `WatchlistCounts`, and `WatchlistMoodSummary` are likewise re-exported via the media subpath for one coherent client import surface.
- [ ] The shared module stays isomorphic and zod-only (no `drizzle-orm` / `hono` / framework deps — shared-package rule).
- [ ] Codec unit tests assert `decode → null` on bad / foreign / mode-mismatched input for **both** modes, and that `encodeSeedCursor` / `decodeSeedToken` round-trip.
- [ ] Changeset: **empty frontmatter** (`@nama/shared` is internal-only and never listed; no server behavior changes yet).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-002: Consumer source-registration maps via barrels

**Description:** As a backend developer, I want each consumer to surface its sources as a registration map through its barrel so that the adapter can build one registry without `media` ever importing concrete sources (§A4, invariant V.RG1).

**Acceptance Criteria:**

- [ ] A `MediaSourceRegistration<P>` interface exists (adapter-visible) with fields: `sourceId: MediaSourceId`, `rateLimit: "read" | "write" | undefined`, `paramSchema: ZodType<P>`, `cursorMode: "keyset" | "offset"`, `cursorOnNull: "400" | "firstPage"`, `requiresInitialCursor?: boolean`, `eligibility?(ctx): Promise<boolean>`, and `build(ctx, params, cursor): { source; cfg; enrichRows? }`.
- [ ] `home/index.ts` exports `homeMediaSources` — a **thin** lift wrapping the existing `ROW_PROVIDERS` (which already carries public `eligibility` / `initialCursor` / `load` / `cursorMode` / `requiresInitialCursor` per `home/internal/types.ts`); the `build` thunk wraps today's row-page load. No home composition logic moves (invariant V.A1).
- [ ] `watchlist/index.ts` exports `watchlistMediaSources` — a **new barrel export** re-packaging the per-section source + cfg wiring (`itemsSource` / `moodItemsSource` / `tonightSource` / `recentlySource` and their `toItemsParams` / `itemsCfg` / `moodItemsCfg` / `recentlyCfg`) that is currently **private to `watchlist/service.ts`**. The wiring stays in `watchlist` (invariant V.A1) — it is only surfaced via the barrel.
- [ ] `cursorOnNull` is set per consumer to preserve V.CU1 exactly: home sources `"400"`, watchlist sources `"firstPage"`.
- [ ] `eligibility` is carried on home registrations (mirrors today's `composeRowPage` 404-on-ineligible).
- [ ] No HTTP endpoint is added in this phase. A unit test asserts the registry builds and every `MEDIA_SOURCE_IDS` entry resolves to a registration whose `build` wires `listRows` with the right stages.
- [ ] Changeset: **empty frontmatter** (server-internal barrel additions; no public wire change yet).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-003: Generic source resolver endpoint

**Description:** As a client developer, I want one paginated read endpoint dispatched by source id so that every media list reads through a single path (§A3).

**Acceptance Criteria:**

- [ ] `api/procedures/media.ts` defines a `REGISTRY: Record<MediaSourceId, MediaSourceRegistration>` composed as `{ ...homeMediaSources, ...watchlistMediaSources }`, and mounts `GET /api/media/sources/:sourceId` **additively** (old endpoints stay).
- [ ] The resolver is dumb dispatch (invariant V.MC1/V.PG1 — no enrich / sort / cursor logic in the resolver): look up the registration (unknown → `404 media.source_unknown`), apply `reg.rateLimit`, build the source context, run `reg.eligibility` if present (ineligible → `404 media.source_ineligible`), parse `reg.paramSchema` (invalid → `400 http.invalid_input`), `decode` the cursor, map `null` per `reg.cursorOnNull` (home `"400" → 400 media.cursor_invalid`; watchlist `"firstPage" → null`), enforce `requiresInitialCursor` (missing → `400 media.cursor_required`), then `build` → `listRows(source, cfg, ctx, enrichRows)` → return the `Page`.
- [ ] **Two-level cursor decode** holds: the resolver decodes only the opaque _outer_ `Cursor`; the source still parses its seed/keyset payload out of `Cursor.k` (`decodeSeedToken` in `similar-paged`, keyset decode in watchlist `items`) — inner-token parsing stays source-side, unchanged.
- [ ] Bounded sources (tonight / recently) return `Page` with `cursor: null`; today's `WatchlistSectionResponse` (`{ items, partial }`) gains the `cursor` field (pre-stable additive).
- [ ] `requireSession` is applied `.use("*")` on the `/api/media` router; `sessionUserId(c)` is read per handler.
- [ ] Resolver unit tests cover: unknown sourceId → 404, ineligible → 404, bad params → 400, cursor-null mapping per `cursorOnNull` (home 400 / watchlist first-page), `requiresInitialCursor` → 400, and rate-limit applied per registration.
- [ ] **Read parity:** for every list source, the resolver returns the same item ids / order / cursor as the corresponding old endpoint (`/home/row`, `/watchlist/items`, `/watchlist/sections/*`, `/watchlist/moods/:moodId/items`). Fixtures are captured from the **live old endpoints before this phase** and asserted against the resolver (RISK-202).
- [ ] Changeset: **empty frontmatter** (additive surface not yet consumed; the user-facing bump lands at cutover US-013).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-004: Title resource endpoints

**Description:** As a client developer, I want a media title's details and availability under the media URL namespace so that the detail view reads from one resource surface (§A2, §A6).

**Acceptance Criteria:**

- [ ] `GET /api/media/:type/:tmdbId/details` is mounted and bridges to `home.composeDetails(ctx, tmdbId, type)` (the existing composer — its payload already carries `seasons` metadata inside `MediaDetailsExtra`). Response type is the unchanged `MediaDetailsResponse`.
- [ ] `GET /api/media/:type/:tmdbId/availability` is mounted and bridges to `home.composeSeasonAvailability(ctx, tmdbId)`. Response type is the unchanged `SeasonAvailabilityResponse`.
- [ ] `:type ∈ {movie, tv}` is a **path** param (today's `/home/details?tmdbId&mediaType` becomes `/api/media/:type/:tmdbId/details`).
- [ ] There is **no separate `/seasons` endpoint** — seasons metadata rides inside `details` (no new composer; preserves invariant V.A1).
- [ ] The composition logic does NOT move out of `home` — the adapter is a one-line bridge per endpoint (RISK-203).
- [ ] Read parity: details and availability outputs match the old `/home/details` and `/home/season-availability` for the same inputs (fixtures captured before this phase).
- [ ] Changeset: **empty frontmatter** (additive; not yet consumed).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-005: Counts, moods, and writes endpoints

**Description:** As a client developer, I want watchlist counts, mood summary, and add/remove writes under the media namespace so that aggregates and mutations share the one surface (§A6).

**Acceptance Criteria:**

- [ ] `GET /api/media/counts` bridges to `watchlist.getCounts(ctx)` (returns the unchanged `WatchlistCounts`).
- [ ] `GET /api/media/moods` bridges to `watchlist.getMoodSummary(ctx)` (returns the unchanged `WatchlistMoodSummary`).
- [ ] `POST /api/media/watchlist` bridges to the `media` writes barrel `addItem`; returns `AddWatchlistResponse` (201 on insert, 200 when already active).
- [ ] `DELETE /api/media/watchlist/:type/:tmdbId` bridges to the `media` writes barrel `removeItem`; returns 204. `:type` / `:tmdbId` are path params.
- [ ] Rate limits are preserved per registration / endpoint policy: counts / moods → `watchlistReadLimiter`; writes → `watchlistWriteLimiter`; limiter instances move with the router, keys unchanged (§A7).
- [ ] Derivation / tally ownership is unchanged — counts and mood summary stay computed where they are today; writes stay `media`-owned (since consolidation Phase 2).
- [ ] Parity: counts and mood-summary outputs match the old `/counts` and `/moods` for the same fixtures.
- [ ] Changeset: **empty frontmatter** (additive; not yet consumed).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

---

### Part B — Client Media Consolidation

> Every Part B story touches `apps/client/` React code. Per project rules, invoke the relevant frontend skill before editing (`frontend-feature-architecture` for feature/shell structure; `vercel-react-best-practices` for components/hooks/data-fetch; `vercel-composition-patterns` for shared component APIs; `vercel-react-view-transitions` / `paraglide-js` where applicable).

### US-006: Shared client media layer

**Description:** As a frontend developer, I want one client media layer — source descriptor, list-hook core, query-key root, error class, cursor codec — so that home and watchlist stop maintaining two of each (§B1, #504/#505/#509, invariant V.CL1).

**Acceptance Criteria:**

- [ ] `apps/client/src/shared/media/source.ts` defines `ClientMediaSource<P>` mirroring the server registration: `{ sourceId: MediaSourceId; params: P; mode: "infinite" | "section"; cursorOnNull: "throw" | "firstPage"; initialCursor?: string | null }`, with `fetchPage(params, cursor)` binding the **one** endpoint `api.media.sources[":sourceId"].$get({ param, query }) → Page`. No per-feature fetcher.
- [ ] `apps/client/src/shared/media/use-media-rows.ts` defines one core `mediaRowsQueryOptions(source)` (infinite query options: `getNextPageParam: p => p.cursor ?? undefined`, flatten pages → `items`, OR-reduce `partial`) plus two thin wrappers: `useMediaRows` (`useSuspenseInfiniteQuery`) and `useMediaRowsLazy` (`useInfiniteQuery`). The cursor / flatten / `partial` logic is defined exactly once.
- [ ] `apps/client/src/shared/media/query-keys.ts` defines a `mediaKeys` root and factory: `mediaKeys.source(sourceId, params)`, `mediaKeys.title(type, tmdbId)`, `mediaKeys.counts()`, `mediaKeys.moods()`.
- [ ] `apps/client/src/shared/media/error.ts` defines one `MediaApiError` and one `throwOnError`.
- [ ] `apps/client/src/shared/media/cursor.ts` re-exports the `@nama/shared/media` codec; `similarTo` builds its initial cursor via `encodeSeedCursor` (closing the consolidation §H client gap).
- [ ] Unit tests cover: `mediaRowsQueryOptions` flatten + `getNextPageParam` + `partial` OR-reduce; suspense vs lazy wrappers; the `similarTo` client-built cursor is accepted by the resolver.
- [ ] Changeset: **empty frontmatter** (new internal client layer; not yet wired into a visible surface).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-007: Shared media primitives and optimistic mutation

**Description:** As a frontend developer, I want one card, one skeleton, and one optimistic-mutation path so that both features render and mutate through shared primitives (§B2, #504/#505/#514).

**Acceptance Criteria:**

- [ ] `apps/client/src/shared/components/media-row-card.tsx` is the single card both features render — a `variant` prop selects rail (16/9) vs grid (2/3), with slots for the match-reason chip (home) and source/added metadata (watchlist). It composes the existing `MediaCard*` primitives.
- [ ] `apps/client/src/shared/components/grid-skeleton.tsx` is the single Suspense grid fallback (shape varies by prop). The existing `shared/components/empty-state/` is composed by per-feature wrappers (e.g. `WatchlistEmpty`) as **sibling** components — no nested sub-folders (repo convention).
- [ ] Shared optimistic add/remove (over `use-optimistic-array-mutation`) invalidates `mediaKeys.root` **once** (not per feature, #505). `useWatchlistIdSet` / `useIsInWatchlist` snapshots are scoped to the watchlist sub-key, not the whole cache (#514).
- [ ] Tests assert the one-shot `mediaKeys.root` invalidation on add/remove and that the id-set snapshot is scoped to the watchlist sub-key.
- [ ] Verify in browser: the shared card renders correctly in both the home rail (16/9) and the watchlist grid (2/3) variants, and the skeleton matches each.
- [ ] Changeset: **empty frontmatter** (shared primitives; behavior-neutral until features migrate).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-008: Migrate watchlist to the shared layer

**Description:** As a frontend developer, I want watchlist reading through the shared media layer and `api.media.*` so that its bespoke fetcher / error / key code is deleted while product chrome is preserved (§B3, #506/#508/#509/#515/#516).

**Acceptance Criteria:**

- [ ] Watchlist registers `ClientMediaSource`s: `watchlist-items` (with `bucket` param), `watchlist-mood-items`, `watchlist-tonight`, `watchlist-recently` — all reading via `api.media.sources[":sourceId"]`.
- [ ] Deleted from watchlist: `lib/fetchers.ts`, the standalone query-key factory (now derived from `mediaKeys`), the `WatchlistItem` re-export (import `CompactMediaItem` directly, #508), and `WatchlistApiError` (use `MediaApiError`).
- [ ] Product chrome is preserved: bucket chips, sort select, mood mosaic/cluster, section headers, the peek modal, and the tonight hero/alternate split.
- [ ] Nits: an unknown `moodId` route param triggers `throw notFound()` (#515); the watchlist card guards `clearLogo` (#516).
- [ ] Section parity holds: items / mood-items / tonight / recently render the same item ids and order as before the migration (asserted against the pre-migration fixtures from US-003).
- [ ] Verify in browser: each watchlist section (items by bucket, mood cluster, tonight, recently) loads, paginates via "load more", and the peek modal opens — visually identical to before.
- [ ] Changeset: **empty frontmatter** (parity migration; no user-visible change).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-009: Migrate home to the shared layer

**Description:** As a frontend developer, I want the home rows reading through the shared media layer so that home's bespoke fetcher / key code is deleted while hero / match-reason / layout are preserved (§B3, #507).

**Acceptance Criteria:**

- [ ] Each `/home/layout` row stub (already carrying `sourceId = rowId` + `initialCursor`) feeds a `useMediaRowsLazy` source; rails render the shared `media-row-card` + `grid-skeleton`.
- [ ] Deleted from home: the `lib/fetchers.ts` row fetcher and the home query-key root (derived from `mediaKeys`).
- [ ] `useHomeDetails` reads via `api.media[":type"][":tmdbId"].details`.
- [ ] Preserved unchanged: the hero / top-zone, the match-reason copy map, layout ordering, and ambient treatment.
- [ ] Layout parity holds: rails render identical item ids / order, and there are **no extra fetches** beyond the layout call + per-row lazy loads (assert against the home-layout fixtures).
- [ ] Verify in browser: the home feed renders all rows with per-row skeletons, hero and match-reason copy are intact, and the network panel shows one layout call plus one lazy fetch per visible row (no duplicate fetches).
- [ ] Changeset: **empty frontmatter** (parity migration; no user-visible change).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-010: Watchlist route loaders

**Description:** As a user, I want watchlist routes to prefetch their first page so that navigation shows content immediately instead of a spinner (§B4, #513).

**Acceptance Criteria:**

- [ ] Each of the watchlist routes gains a `loader` that calls `ensureInfiniteQueryData(mediaRowsQueryOptions(source))` to prefetch the first page, plus an `errorComponent` (TanStack Router convention).
- [ ] Home is unchanged here — it already loader-prefetches its layout; rows stay in-component lazy.
- [ ] Tests assert the loader prefetches the first page (cache is warm on mount) and the `errorComponent` renders on a failed loader.
- [ ] Verify in browser: navigating to a watchlist section route shows content on first paint (no full-section spinner), and a forced fetch error renders the route's `errorComponent`.
- [ ] Changeset: **minor** `@nama/client` — user-facing (faster navigation; one short past-tense end-user sentence).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-011: Paraglide ICU variants

**Description:** As a maintainer, I want the watchlist and home labels expressed as keyed ICU variants so that the message count drops and translations stay consistent (§B4, #511/#512).

**Acceptance Criteria:**

- [ ] Bucket / empty / chip-ARIA labels and section / cluster / mood / sort labels are converted to ICU variants keyed on `{bucket}` / `{moodId}` / `{sortKey}` (per the `paraglide-js` skill).
- [ ] The message count on the watchlist + home surface drops by **≥ 30%** versus before.
- [ ] No user-visible copy changes — each variant renders the same string as the message it replaced (assert a representative set).
- [ ] Verify in browser: bucket chips, empty states, and section/mood/sort labels render identical copy to before the variant conversion.
- [ ] Changeset: **empty frontmatter** (i18n refactor; no user-visible copy change).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-012: All-items virtual scroll

**Description:** As a user, I want the all-items watchlist views virtualized so that long lists stay smooth (§B4, #519).

**Acceptance Criteria:**

- [ ] The all-items "load more" lists (every bucket + mood route) render through `useVirtualizer` over `useMediaRows`, fetching the next page near the window end.
- [ ] Only the visible window (plus overscan) is in the DOM for a long list.
- [ ] Tests assert a page fetch fires when the scroll position nears the window end.
- [ ] Verify in browser: scrolling a long bucket / mood list keeps the DOM node count bounded and fetches the next page near the end, with no visual jank.
- [ ] Changeset: **minor** `@nama/client` — user-facing (smoother long lists; one short past-tense end-user sentence).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

---

### Cutover

### US-013: Delete the old surface and dead client code

**Description:** As a maintainer, I want the old per-product endpoints and client shims removed so that `api.media.*` and the shared layer are the only media surface (§A8, §D cutover Z).

**Acceptance Criteria:**

- [ ] Deleted (pre-stable, no shim): the `/home/row` route from `api/procedures/home.ts`, the `/home/details` and `/home/season-availability` routes, and **all** of `api/procedures/watchlist.ts`. `/home/layout` is **kept** (the home procedure is now layout-only).
- [ ] `api/router.ts` is re-pointed: mount `mediaApp` at `/media`; the home group keeps only `/layout`; the `/watchlist` mount is dropped. `AppType` regenerates so `api.media.*` is canonical and `api.watchlist.*` + `api.home.{row,details,season-availability}` no longer exist.
- [ ] Client dead code is deleted: any remaining home/watchlist fetcher / hook / type shims superseded by `shared/media/`.
- [ ] The `.fallow/dead-code-baseline.json` baseline does **not** grow (Rule 14); any intentional exception carries an inline `// fallow-ignore-*` with a one-line reason.
- [ ] A grep gate confirms no caller references the deleted endpoints, `WatchlistItem`, `HomeApiError`, or `WatchlistApiError`.
- [ ] Verify in browser: a full smoke pass — home feed, every watchlist section, the peek/detail view, and add/remove — works end-to-end against `api.media.*` only (network panel shows no `/home/row`, `/watchlist/*`, `/home/details`, or `/home/season-availability` calls).
- [ ] Changeset: **minor** `@nama/client` and `@nama/server` — user-facing (media data now served from one unified API; one short past-tense end-user sentence). Note cursor invalidation on deploy (RISK-206).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

## Functional Requirements

- **FR-1:** The system MUST expose one media wire surface under `/api/media/*`: a generic source resolver for every paginated read plus dedicated title / counts / moods / writes endpoints. There MUST be exactly one client (`api.media.*`).
- **FR-2:** `GET /api/media/sources/:sourceId` MUST be a single registry-dispatched handler. The resolver MUST be dumb dispatch — it MUST NOT contain enrich / sort / cursor logic; `listRows` owns the pipeline (invariants V.MC1 / V.PG1).
- **FR-3:** A `MediaSourceRegistration<P>` MUST carry per-source `sourceId`, `rateLimit`, `paramSchema`, `cursorMode`, `cursorOnNull`, optional `requiresInitialCursor`, optional `eligibility`, and `build`. The adapter registry MUST be `{ ...homeMediaSources, ...watchlistMediaSources }`.
- **FR-4:** `media` MUST NOT import concrete sources. The source registry MUST live in the `api/` adapter, composed from consumer **barrels** (invariant V.RG1). No composition logic MUST move between `home`, `watchlist`, and `media` (invariant V.A1).
- **FR-5:** `@nama/shared/media` MUST export a `MEDIA_SOURCE_IDS` as-const tuple and derived `MediaSourceId` as the one source-id set for client and server. It MUST NOT collide with or modify the existing recommendation-engine `MediaItem`.
- **FR-6:** The cursor codec (`Cursor`, `encode`, `decode`, `encodeSeedCursor`) MUST live in `@nama/shared/media`; the server `media` barrel MUST re-export it so server-internal callers keep their barrel import. `decodeSeedToken` / `SeedToken` MUST stay home-source-private.
- **FR-7:** `decode` MUST return `Cursor | null` and MUST NOT throw. The resolver MUST map `null` per `reg.cursorOnNull`: home → `400`, watchlist → first-page (invariant V.CU1).
- **FR-8:** The canonical page shape MUST be `Page = { items: CompactMediaItem[]; cursor: string | null; partial: boolean }`, superseding `RowContentResponse` / `WatchlistResponse` / `WatchlistSectionResponse`. Bounded sources MUST mint `cursor: null`.
- **FR-9:** The title resource MUST be `GET /api/media/:type/:tmdbId/details` (→ `home.composeDetails`, incl. seasons metadata) and `…/availability` (→ `home.composeSeasonAvailability`). There MUST be no separate `/seasons` endpoint.
- **FR-10:** Counts MUST bridge to `watchlist.getCounts`, moods to `watchlist.getMoodSummary`, and writes to the `media` writes barrel. Derivation / tally / write ownership MUST be unchanged.
- **FR-11:** `requireSession` MUST be applied `.use("*")` on the `/api/media` router. Per-surface rate limits MUST be preserved: watchlist-origin sources + counts/moods → read limiter; writes → write limiter; home-origin sources + title → none.
- **FR-12:** The client MUST read every paginated source via the one `api.media.sources[":sourceId"]` binding through `ClientMediaSource.fetchPage`. There MUST be no per-feature fetcher.
- **FR-13:** The client MUST define one `mediaRowsQueryOptions` core with `useMediaRows` (suspense) and `useMediaRowsLazy` (lazy) as thin wrappers, one `MediaApiError`, and one `mediaKeys` root from which feature key factories derive (invariant V.CL1).
- **FR-14:** Optimistic add/remove MUST invalidate `mediaKeys.root` once (not per feature). The watchlist id-set snapshot MUST be scoped to the watchlist sub-key, not the whole cache.
- **FR-15:** The migration MUST be additive-first / subtractive-last: Part A adds `/api/media/*` without removing the old endpoints; the old surface MUST be deleted only in the cutover (US-013), after the client migrates. This is sequencing, NOT a compat shim — no translation layer, no dual maintenance.
- **FR-16:** Read parity MUST hold for every source and the title/counts/moods endpoints: resolver/endpoint output MUST equal the pre-refactor endpoint output (item ids / order / cursor), asserted against fixtures captured from the live old endpoints before US-003 / US-004 / US-005.

## Non-Goals (Out of Scope)

- **Any server module re-org.** No composition logic moves between `home`, `watchlist`, and `media` (§A1). This is an adapter + wire + client change only.
- Collapsing `home` / `watchlist` into `media` (god-module — rejected upstream; product logic ≠ domain logic).
- `search` and `command-menu` (different read model: query → ranked results, not the list pipeline).
- Compat shims, deprecation chains, or dual-surface translation (pre-stable: delete the old endpoints outright).
- Any user-visible behavior change beyond what each adjacent track (#511–#519) explicitly specifies. Parity fixtures guard reads.
- Moving the `CompactMediaItem` **definition** (vs re-export) into `@nama/shared/media` (deferred; re-export only here).
- Generic write/aggregate collapse beyond the namespace move.
- Changing seed/sync lifecycle internals, events, plugin-dispatch, or the hero/match-reason heuristics — unchanged.

## Technical Considerations

- **Toolchain:** Use Vite+ (`vp`) only — `vp check`, `vp test`, `vp install`. Never invoke pnpm/npm/yarn or Vitest/Oxlint/tsdown directly. Use `vp dlx` for one-off binaries.
- **Adapter principle:** The URL reflects the _resource_, the owning module reflects the _logic_, and the `api/` adapter bridges them (backend-arch Rule 10: adapters call module barrels; modules never call adapters). The title resource lives at a media URL while its composition stays home-owned — document this so navigators don't expect home logic to move (RISK-203).
- **Shared package:** Extend the existing `@nama/shared/media`; new exports land alongside `MediaItem` without collision. The module stays isomorphic and zod-only. Per project rule, `@nama/shared` is **never** listed in a changeset — its changes ride the consumer bump.
- **Changesets per phase:** Additive server phases (US-001…US-005) and parity client migrations (US-006…US-009, US-011) are **internal** → empty-frontmatter changesets. The user-facing `minor` bumps land at US-010 (`@nama/client`), US-012 (`@nama/client`), and US-013 (`@nama/client` + `@nama/server`). Descriptions are one short past-tense end-user sentence — no file names, PR numbers, or impl detail.
- **Frontend skills:** Every Part B story edits `apps/client/` React — invoke the relevant skill before editing (`frontend-feature-architecture`, `vercel-react-best-practices`, `vercel-composition-patterns`, `paraglide-js`, `vercel-react-view-transitions`).
- **Parity fixtures (RISK-202):** Capture home-row, watchlist-section, mood-items, details, availability, counts, and moods output fixtures from the **live old endpoints before** US-003 / US-004 / US-005, then assert the resolver/endpoints against them. Additive sequencing keeps old and new serving the same data in parallel until cutover, so fixtures can pin agreement before deletion.
- **Cursor invalidation (RISK-206):** The codec move + endpoint reshape invalidate existing cursors on deploy. Acceptable pre-stable (cursors are ephemeral React-Query cache state); note it in the US-013 changeset.
- **Two-plan A/B seam (RISK-205):** Part A (server + wire, additive) and Part B (client) are independently plannable; B's only hard dependency on A is the §A5 contract plus the additive surface. US-010…US-012 (loaders / paraglide / virtual) are splittable into their own follow-ups if the train stalls — they do not block the core consolidation (US-006…US-009).
- **Compact between phases:** Each phase is its own focused session / PR; compact context at phase boundaries.

## Success Metrics

- One media wire surface exists: after cutover, `api.media.*` is the only media client; `api.watchlist.*` and `api.home.{row,details,season-availability}` no longer exist (`AppType` proves it).
- The client has exactly one of each: one `MediaApiError`, one `mediaRowsQueryOptions` core (two thin wrappers), one `mediaKeys` root. `HomeApiError`, `WatchlistApiError`, both per-feature fetchers, and both bespoke list hooks no longer exist.
- `MEDIA_SOURCE_IDS` is the single source-id set; client and server import the same `@nama/shared/media` module; the `similarTo` initial cursor is built client-side via the shared codec.
- Read parity holds: every source and the title/counts/moods endpoints produce identical item ids / order / cursor to the pre-refactor endpoints.
- Paraglide message count on the watchlist + home surface drops by ≥ 30% (#511/#512).
- The `.fallow/dead-code-baseline.json` count is unchanged or lower at the end of the cutover.
- All 13 phases land with `vp check` and `vp test` green.

## Open Questions

- US-010…US-012 (route loaders / Paraglide variants / virtual scroll) land inside this epic per the chosen full scope, but remain splittable into a follow-up if the PR train stalls (RISK-205). Confirm at the B4 boundary whether to split.
- Whether to later move the `CompactMediaItem` **definition** (vs re-export) into `@nama/shared/media` — deferred; revisit once the media subpath is the established import surface.
- The machine-readable `scripts/ralph/prd.json` mirror is deferred until the stories here are settled; generate it before running the autonomous loop.
- Confirm no non-test caller outside `home` / `watchlist` references the deleted endpoint clients or `WatchlistItem` / `HomeApiError` / `WatchlistApiError` before deletion in US-013 (grep gate during cutover).

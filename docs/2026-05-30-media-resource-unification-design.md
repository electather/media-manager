# Media Resource Unification — Adapter-Level `/api/media/*` + Shared Client Media Layer

**Status:** design (rev 1)
**Date:** 2026-05-30
**Author:** Omid Astaraki
**Epic:** [#491](https://github.com/electather/media-manager/issues/491) — frontend half. Realizes the deferred §I endpoint collapse + folds in #504–#519 (open; #517/#518 already closed).
**Extends:** [2026-05-26-media-pipeline-consolidation-design.md](./2026-05-26-media-pipeline-consolidation-design.md) — §I (endpoint surface, deferred there → decided here), §E (cursor codec → moved to shared here), §D (`CompactMediaItem` → now the one client shape too).
**Deps:** the consolidation doc, [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md), [2026-05-23-watchlist-sections-design.md](./2026-05-23-watchlist-sections-design.md), [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), `frontend-feature-architecture` + `backend-feature-architecture` skills.
**Scope:** API adapter layer (`apps/server/src/api/`) + wire contract (`@ent-mcp/shared/media`) + client (`apps/client/`). **No server module re-org** (§A1). Two parts: **A** server API + wire, **B** client consolidation.

Caveman ultra. Pseudo = shape only. ⊥ = not/none/false, ∪ = union, → = maps-to/becomes, ∀ = for-all, ≥ = at-least.

## Revision history

- **rev 1 (2026-05-30)** — Initial unification design.

## Problem

The consolidation (#491 backend, shipped `dacd3825`) unified the server *read pipeline*: `media.listRows(source, cfg)` is the one read path; home rows + watchlist sections are all `MediaSource`s; counts/moods are count-mode aggregates; writes live in `media`. Residue, all on the surfaces it did **not** touch (§O of that doc: "frontend… future client doc"):

1. **Endpoint surface still forks per product.** `api/procedures/home.ts` (`/home/layout`, `/home/row`, `/home/details`, `/home/season-availability`) + `api/procedures/watchlist.ts` (`/watchlist/items`, `/counts`, `/sections/{tonight,recently}`, `/moods`, `/moods/:moodId/items`, `POST /`, `DELETE /:tmdbId/:mediaType`). Two hand-written procedure files, same job (serve media). The internal pipeline is one; the wire is two. §I deferred the decision.
2. **No shared `sourceId` contract.** sourceIds exist as inline strings (`recommendedForYou-tv`, `watchlist.items`, …) scattered across `home/rows/index.ts` + `watchlist/sources/*`. Client + server never agree on a typed set.
3. **Cursor codec is server-only.** `media/cursor.ts` (encode/decode/`Cursor`/seed-token) lives server-side. The client passes cursors verbatim — fine until `similarTo`, whose seed cursor "the client constructs" (consolidation §H), with format "deferred to the client doc." The client has no codec → the gap is open.
4. **Client duplicates the pipeline's product split, badly.** Two fetcher files (`home/lib/fetchers.ts`, `watchlist/lib/fetchers.ts`), two error classes (`HomeApiError`, `WatchlistApiError`), two `throwOnError`, two query-key factories with no shared root, two near-identical infinite-list hooks (home `useHomeRow` non-suspense vs watchlist `useAllItems`/`useMoodCluster` suspense — same flatten/cursor/`partial` mechanics), two card assemblies over the same `MediaCard*` primitives, two skeleton patterns. Epic #491 frontend bucket (#504–#510).
5. **Adjacent debt riding the same files** — paraglide variants (#511/#512), watchlist route loaders (#513), correctness nits (#514/#515/#516), all-items virtual scroll (#519).

Root cause: the *internal* read path collapsed; the *surface* (HTTP wire) and its *client mirror* did not. The pipeline is unified one layer too deep.

## Goals / non-goals

**Goals**
- One media wire surface: `/api/media/*` — a generic source resolver for every paginated read + dedicated title/counts/moods/writes endpoints. One `api.media.*` client.
- One shared wire contract module `@ent-mcp/shared/media`: `MEDIA_SOURCE_IDS` tuple, the cursor codec (moved from server), per-source param schemas, `Page`. Closes the `similarTo` cursor gap (#3) by sharing one codec.
- One client media layer (`apps/client/src/shared/media/`): one list hook (suspense + non-suspense), one query-key root, one `MediaApiError`, shared row-card/grid-skeleton/empty primitives. home + watchlist = thin shells.
- Fold the adjacent tracks (#511–#519) as later phases.

**Non-goals**
- **⊥ server module re-org (§A1).** No composition logic moves between `home`/`watchlist`/`media`. This is an adapter + wire change. Detail/season composition stays home-owned; tonight ranking + mood derivation stay watchlist-owned; pipeline stays media.
- ⊥ collapse home/watchlist into media (god-module, rejected upstream — *product logic ≠ domain*, consolidation §A non-goals).
- ⊥ touch `search` / `command-menu` (different read model: query→ranked results, not the list pipeline).
- ⊥ compat shims / deprecation chains. Pre-stable: delete old endpoints outright, reshape the wire cleanly (project rule: DB/API breaking changes acceptable pre-stable).
- ⊥ user-visible behavior change beyond what each adjacent track (#511–#519) explicitly specifies. Parity fixtures guard reads.

---

# PART A — Media Resource API (server adapter + wire)

## §A1 — Governing principle: adapter + wire only, ⊥ module re-org

The docs fix two axes independently:
- **Module ownership = logic.** `media` = FAT domain/pipeline/storage/writes; `home`/`watchlist` = THIN product shells owning their envelopes ("Sources are media-domain; **envelopes are product, stay in consumers**" — consolidation §H). Detail/season composition is home product, "unchanged" (home-backend §intro; consolidation §H). `media` ⊥ import home/watchlist (no cycle).
- **URL namespace = resource identity.** Endpoints are *adapter* concern: "Adapters (`api/`, `mcp/`) only call module barrels; modules never call adapters" (backend-arch Rule 10).

⇒ Unifying the URL surface is a pure **adapter** reorganization. `/api/media/*` is a new adapter (`api/procedures/media.ts`) that composes the *existing* `home`/`watchlist`/`media` barrels. **Rule: URL reflects the resource; the owning module reflects the logic; the adapter bridges them.** Detail's *resource* is a media title (cross-feature: `useHomeDetails` already serves home peek + media-detail + watchlist peek) → media URL; its *composition* is home product → stays in `home/`. Adapter calls `home.composeDetails`.

Nothing in `home/`, `watchlist/`, `media/` modules moves. Changes: `api/procedures/*`, `api/router.ts`, and `@ent-mcp/shared`.

## §A2 — Endpoint surface (target)

```
GET    /api/media/sources/:sourceId?cursor&<source params>     # ALL paginated reads
GET    /api/media/:type/:tmdbId/details                        # title resource (adapter → home.composeDetails; incl. seasons metadata)
GET    /api/media/:type/:tmdbId/availability                   #   per-server presence (adapter → home.composeSeasonAvailability)
GET    /api/media/counts                                       # adapter → watchlist.getCounts
GET    /api/media/moods                                        # adapter → watchlist.getMoodSummary
POST   /api/media/watchlist                                    # adapter → media writes barrel
DELETE /api/media/watchlist/:type/:tmdbId                      # adapter → media writes barrel

# stays — home-only product composition, no media-resource analog:
GET    /api/home/layout
```

`:type` ∈ `{movie,tv}`. `details` = today's `/home/details` payload (`MediaDetailsResponse` — already carries `seasons` metadata inside `MediaDetailsExtra`). `availability` = today's `/home/season-availability` (`SeasonAvailabilityResponse` — per-server presence, show-only). **⊥ a separate `/seasons` endpoint** — seasons metadata rides inside `details`. Two composers exist today (`composeDetails` + `composeSeasonAvailability`) → two URLs, pure relocation, ⊥ new composer (preserves §A1).

## §A3 — Source resolver contract

`GET /api/media/sources/:sourceId` — one handler, registry-dispatched.

```
resolver(c):
  reg = REGISTRY[sourceId]                       ?? throw 404 media.source_unknown
  applyRateLimit(reg.rateLimit, c)               // §A7
  ctx = buildSourceContext(sessionUserId(c))     // requireSession is global on /api/media
  if reg.eligibility && ⊥ await reg.eligibility(ctx): throw 404 media.source_ineligible
  params = reg.paramSchema.parse(c.req.query)     // zValidator → 400 http.invalid_input on fail
  cursor = decode(rawCursor, reg.cursorMode)      // shared codec; never throws → Cursor|null
  if cursor === null ∧ rawCursor present:
     reg.cursorOnNull === "400" ? throw 400 media.cursor_invalid : cursor = null   // V.CU1
  if cursor === null ∧ reg.requiresInitialCursor: throw 400 media.cursor_required
  { source, cfg, enrichRows } = reg.build(ctx, params, cursor)
  page = await listRows(source, cfg, ctx, enrichRows)    // media barrel; enrichRows optional (home strategy)
  return c.json(page)                              // Page = { items, cursor, partial }
```

- Response is the **one** `Page` shape (§A5) ∀ sources. Bounded sources (tonight/recently) mint `cursor:null`; home/watchlist list sources thread keyset/offset cursors. Today's `WatchlistSectionResponse` (`{items,partial}`, no cursor) → `Page` with `cursor:null` (pre-stable add of the field).
- **Two-level cursor decode:** resolver decodes only the opaque *outer* `Cursor` (`decode(raw, mode) → Cursor|null`); the source still parses its seed/keyset payload out of `Cursor.k` (`decodeSeedToken` in `similar-paged`, `decodeKeyset` in watchlist `items`). Resolver stays dumb dispatch (RISK-201); inner-token parse stays source-side, unchanged.
- V.MC1/V.PG1 unchanged — resolver runs no enrich/sort/cursor logic; `listRows` owns the pipeline.

## §A4 — Source registry (adapter-side; V.RG1 holds)

`media` ⊥ import concrete sources (V.RG1). So the registry lives in the **adapter**, aggregating maps each consumer surfaces via its **barrel** (Rule-10-clean: adapter calls module barrels):

```
// home/index.ts (barrel) exports homeMediaSources; watchlist/index.ts exports watchlistMediaSources.
interface MediaSourceRegistration<P> {
  sourceId: MediaSourceId                          // from shared tuple (§A5)
  rateLimit: "read" | "write" | ⊥                  // preserve current limits (§A7)
  paramSchema: ZodType<P>                           // discriminated per source (§A5)
  cursorMode: "keyset" | "offset"
  cursorOnNull: "400" | "firstPage"                 // V.CU1 per-consumer mapping
  requiresInitialCursor?: boolean                   // similarTo
  eligibility?(ctx: SourceContext): Promise<boolean>// home rows only; ⊥ ⇒ always eligible
  build(ctx, params, cursor): { source: MediaSource<P,Row>; cfg: PipelineConfig<P>; enrichRows?: EnrichRowsFn<Row> }
}

// api/procedures/media.ts
const REGISTRY: Record<MediaSourceId, MediaSourceRegistration> = { ...homeMediaSources, ...watchlistMediaSources }
```

- These maps **surface the existing registries**, lift varies by side. **home** = thin: `ROW_PROVIDERS` (rowId→provider) already carries public `eligibility`/`initialCursor`/`load`/`cursorMode`/`requiresInitialCursor` (`home/internal/types.ts`); the `build` thunk wraps today's `loadRowPage`. **watchlist** = heavier: the per-section factories (`itemsSource(params)`/`moodItemsSource`/`tonightSource`/`recentlySource`) + their cfg wiring (`toItemsParams`/`itemsCfg`/`moodItemsCfg`/`recentlyCfg` + `readSection`'s cursor-decode) are today **private to `watchlist/service.ts`** → `watchlistMediaSources` is a **new barrel export** re-packaging that source+cfg pairing. ⊥ composition logic moves modules (V.A1 holds — it stays in `watchlist`, just surfaced via barrel).
- `eligibility` mirrors today's `composeRowPage` 404-on-ineligible (defense-in-depth for direct hits; home layout still pre-filters eligible rows into its stub list).
- `cursorOnNull`: home sources `"400"` (home feed wraps bad cursor→400 today); watchlist sources `"firstPage"` (keyset + offset-snapshot both null→first-page today). Preserves V.CU1 exactly.

## §A5 — Wire contract → `@ent-mcp/shared/media` (NEW subpath)

**Extend the existing** `@ent-mcp/shared/media` (`packages/shared/src/media/` — already ships `enums`/`types`/`schemas`/`rows`/`index`; subpath already wired in `packages/shared/package.json`). ⚠ It already defines a recommendation-engine `MediaItem` (consolidation §D: *"`MediaItem` is already taken… Do **not** reuse it"*) + `ActiveRow`/`RowSort`/`RowFilter` (the server `media` barrel re-exports these). New exports land **alongside** — ⊥ collide names, ⊥ touch `MediaItem`. Isomorphic, zod-only (shared rule). Add:

- **`MEDIA_SOURCE_IDS` as-const tuple** + derived `MediaSourceId` type. One source of truth for client + server (kills #2). Values (lift existing slugs):
  `recommendedForYou-tv`, `recommendedForYou-movies`, `continueWatching-active`, `continueWatching-next`, `becauseYouWatched`, `similarTo`, `yourWatchlist`, `upcomingForYou`, `trendingNow`, `newReleases`, `watchlist-items`, `watchlist-mood-items`, `watchlist-tonight`, `watchlist-recently`.
  (Watchlist buckets ride `watchlist-items` as the `bucket` **param**, ⊥ per-bucket ids — matches server `ItemsParams`.)
- **Cursor codec moved here** — `Cursor` type, `encode`/`decode(raw, expectedMode?)`, + the `encodeSeedCursor` helper (so client + `similar-paged` mint the seed cursor identically). `decodeSeedToken`/`SeedToken` (home's similar-feed `offset` paging) stay **home-source-private** — ⊥ relocated (would drag home paging across the boundary). The definition relocates; the server `media` barrel **re-exports** it, so server-internal consumers (`home/sources/similar-paged.ts`, today importing `encode`/`Cursor` from the `media` barrel) keep their barrel import unchanged (V.RG1 untouched). `media/cursor.ts` becomes a thin re-export. Client imports `@ent-mcp/shared/media` directly (shared-package rule). Same codec both sides → client builds `similarTo` initial cursor with it (closes #3).
- **Per-source param zod schemas** (discriminated): `watchlist-items` (`{bucket?,sort,mood?,limit,cursor?}`), `watchlist-mood-items` (`{moodId,limit,cursor?}`), seeded home (`{seedId,seedType}` for `similarTo`), bounded (`{limit}`), void. Reuse today's `itemsQuerySchema`/`moodItemsQuerySchema` shapes — relocate into the per-source registry schema map.
- **`Page`** = `{ items: CompactMediaItem[]; cursor: string | null; partial: boolean }` (canonical; supersedes `RowContentResponse`/`WatchlistResponse`/`WatchlistSectionResponse`).
- `CompactMediaItem` already lives at `@ent-mcp/shared/home`; **re-export from `@ent-mcp/shared/media`** as the canonical media item home (home types module keeps the definition to avoid a churn cascade; media subpath re-exports). Optional later: move the definition. `MediaDetailsResponse`/`SeasonAvailabilityResponse`/`WatchlistCounts`/`WatchlistMoodSummary` re-exported via media subpath for one coherent client import surface.

Changeset: **minor** `@ent-mcp/shared` + `@ent-mcp/server` (new public surface; old endpoints deleted — pre-stable).

## §A6 — Title / counts / moods / writes (adapter exposure)

Pure URL relocation; impl untouched:
- **Title** (B): `/api/media/:type/:tmdbId/details` → `home.composeDetails(ctx, tmdbId, type)` (incl. seasons metadata); `…/availability` → `home.composeSeasonAvailability(ctx, tmdbId)`. `:type` now a path param (today `/home/details?tmdbId&mediaType`); same response types. ⊥ separate `/seasons` (rides in `details`).
- **counts** → `watchlist.getCounts(ctx)`; **moods** → `watchlist.getMoodSummary(ctx)`. Derivation/tally ownership unchanged (§G consolidation).
- **writes** → `media` writes barrel (`addItem`/`removeItem`; already media-owned since consolidation Phase 2). `POST` returns `AddWatchlistResponse` (201/200); `DELETE` 204. `:type/:tmdbId` path params.

## §A7 — Auth · rate-limit · eligibility · cursor-null

- **Auth:** `requireSession` applied `.use("*")` on the `/api/media` router (matches both procedures today). `sessionUserId(c)` per handler.
- **Rate limit:** preserve current per-surface limits via `reg.rateLimit` + per-endpoint policy. Watchlist-origin sources + counts/moods → `watchlistReadLimiter` (today's). Home-origin sources + title → none (home has none today). Writes → `watchlistWriteLimiter`. (Limiter instances move with the router; keys unchanged.)
- **Eligibility:** §A4 — home registrations carry it; resolver 404s ineligible direct hits.
- **Cursor-null:** §A3/§A4 — `cursorOnNull` + `requiresInitialCursor` reproduce V.CU1 per-consumer behavior under one resolver.

## §A8 — Deletions (executed as the FINAL phase, after client migration)

**Additive-first, subtractive-last.** A1–A5 add `/api/media/*` **without** removing the old endpoints; B1–B4 migrate the client onto it; only then does this phase delete the old surface. The transient window where both surfaces exist is *sequencing*, ⊥ a compat shim (no translation layer, no dual maintenance — old endpoints sit untouched until deleted). This decouples Part A from Part B (RISK-205): neither breaks the other mid-train.

Delete (pre-stable, no shim): `api/procedures/home.ts` `/row` route; **all** of `api/procedures/watchlist.ts`. **Keep** `/home/layout` (procedure now layout-only). Re-point `api/router.ts`: mount `mediaApp` at `/media`; home group keeps only `/layout`; drop the `/watchlist` mount. `AppType` regenerates → `api.media.*` is canonical, `api.watchlist.*` + `api.home.{row,details,season-availability}` vanish.

---

# PART B — Client Media Consolidation

Mirrors Part A on the client: a shared media layer = the "thin pipeline"; home/watchlist features = thin shells (the consolidation pattern, client side). Consumes `api.media.*` only.

## §B1 — Shared client media layer (`apps/client/src/shared/media/`)

- **`source.ts`** — `ClientMediaSource<P>` descriptor mirroring the server registration: `{ sourceId: MediaSourceId; params: P; mode: "infinite" | "section"; cursorOnNull: "throw" | "firstPage"; initialCursor?: string | null }`. `fetchPage(params, cursor)` binds the **one** endpoint `api.media.sources[":sourceId"].$get({ param, query })` → `Page` (⊥ per-feature fetcher; closes #4 fetcher fork + #509).
- **`use-media-rows.ts`** — one core `mediaRowsQueryOptions(source)` (infinite query options: `getNextPageParam: p => p.cursor ?? undefined`, flatten pages → `items`, OR-reduce `partial`). Two thin wrappers over it: `useMediaRows` (`useSuspenseInfiniteQuery` — watchlist sections, route-loader-prefetched) + `useMediaRowsLazy` (`useInfiniteQuery` — home rows, parallel per-row skeleton, app-shell pool). One cursor/flatten/`partial` definition (kills the two-hook fork #4 / #505).
- **`query-keys.ts`** — `mediaKeys` root + factory: `mediaKeys.source(sourceId, params)`, `mediaKeys.title(type, tmdbId)`, `mediaKeys.counts()`, `mediaKeys.moods()`. home/watchlist key factories **derive** from `mediaKeys` (⊥ independent roots → one-shot invalidation, #505/#514).
- **`error.ts`** — one `MediaApiError` (replaces `HomeApiError` + `WatchlistApiError`); one `throwOnError`.
- **`cursor.ts`** — re-export shared `@ent-mcp/shared/media` codec; `similarTo` builds its initial cursor via `encodeSeedCursor` (the §H gap, now closed client-side). _CLAUDE.md prefers direct shared imports over re-export shims; this module is retained as a deliberate exception so the client media layer keeps one coherent cursor surface — flagged here per Rule 7._

## §B2 — Shared primitives + optimistic (#504/#505/#514)

- `shared/components/media-row-card.tsx` — the one card both features render (variant prop for rail 16/9 vs grid 2/3; slots for match-reason chip [home] vs source/added [watchlist]). Composes existing `MediaCard*` primitives. Replaces home `Card` + `WatchlistCard` assemblies.
- `shared/components/grid-skeleton.tsx` — one Suspense grid fallback (shape varies by prop). `shared/components/empty-state/` already exists → per-feature wrappers (`WatchlistEmpty`) compose it (⊥ nested sub-folders, repo convention).
- Shared optimistic add/remove (over `use-optimistic-array-mutation`) invalidating `mediaKeys.root` **once** (not per-feature, #505). `useWatchlistIdSet`/`useIsInWatchlist` snapshots scoped to the watchlist sub-key, not the whole cache (#514).

## §B3 — Thin shells

- **watchlist** (#506/#508/#509): register `ClientMediaSource`s (`watchlist-items` w/ bucket param, `watchlist-mood-items`, `watchlist-tonight`, `watchlist-recently`). Delete `lib/fetchers.ts`, the standalone query-key factory (derive from `mediaKeys`), the `WatchlistItem` re-export (import `CompactMediaItem` direct, #508), `WatchlistApiError`. Keep product chrome: bucket chips, sort select, mood mosaic/cluster, headers, peek modal, tonight hero/alternate split. Nits: `moodId` → `throw notFound()` guard (#515), `watchlist-card` `clearLogo` guard (#516).
- **home** (#507): row stubs from `/home/layout` already carry `sourceId` (= `rowId`) + `initialCursor` → feed each into `useMediaRowsLazy`. Delete `lib/fetchers.ts` `row` fetcher + home query-key root (derive from `mediaKeys`); rails render the shared card + skeleton. Keep hero/top-zone, match-reason copy map, layout, ambient. `useHomeDetails` → `api.media[":type"][":tmdbId"].details`.

## §B4 — Adjacent tracks (later phases)

- **Route loaders (#513):** 8 watchlist routes → `loader` `ensureInfiniteQueryData(mediaRowsQueryOptions(source))` (first page) + `errorComponent` (TanStack convention). Home already loader-prefetches layout; rows stay in-component lazy.
- **Paraglide variants (#511/#512):** bucket/empty/chip-ARIA + section/cluster/mood/sort labels → ICU variants keyed on `{bucket}`/`{moodId}`/`{sortKey}`. ≥30% message-count drop on the watchlist+home surface.
- **Virtual scroll (#519):** all-items "load more" → `useVirtualizer` infinite over `useMediaRows`; page fetch near window end. ∀ bucket + mood routes.

---

## §C — Invariants

- **V.A1** — ⊥ composition logic moves between `home`/`watchlist`/`media` modules. Unification touches only `api/`, `@ent-mcp/shared`, `apps/client`. (§A1.)
- **V.RG1** — `media` ⊥ import concrete sources. Registry lives in the `api/` adapter, composed from consumer barrels.
- **V.CU1** — shared `decode` never throws (bad/foreign/mode-mismatch → `null`). Resolver maps `null` per `reg.cursorOnNull` (home → 400, watchlist → first-page), preserving today's per-consumer behavior.
- **V.WIRE1** — exactly one media item shape (`CompactMediaItem`), one page shape (`Page`), one cursor codec (`@ent-mcp/shared/media`), one source-id set (`MEDIA_SOURCE_IDS`). Client + server import the same contract module.
- **V.MC1/V.PG1** — unchanged from consolidation: resolver/source carry no enrich/sort/cursor logic; pipeline preserves #500 empty-streak `cursor:null` + #501 sparse page + RISK-005 ceiling.
- **V.CL1** — one client list hook core (`mediaRowsQueryOptions`); suspense/lazy are thin wrappers. One `MediaApiError`. home/watchlist key factories derive from `mediaKeys.root`.

## §D — Phases

Each phase: own PR, changeset, `vp check` + `vp test` green, parity fixtures where reads must not change. Compact between phases.

**Two plans along the A/B seam** (RISK-205): Part A (server+wire, **additive**) and Part B (client) are independently plannable. A1–A5 *add* `/api/media/*` without removing the old surface, so they land and sit before B starts; B's only hard dep on A is the §A5 contract + the additive surface. The old-surface deletion is the **final cutover phase** (Z), after B migrates — neither part breaks the other mid-train. Plan + land A first.

**Part A — server + wire (additive)**
- **A1.** Extend `@ent-mcp/shared/media` (§A5): `MEDIA_SOURCE_IDS` tuple, move cursor codec + `encodeSeedCursor` here (⊥ `decodeSeedToken`/`SeedToken` — stay home-private; alongside the existing `MediaItem`/`ActiveRow`/`RowSort` — ⊥ collide), per-source param schemas, `Page`, re-exports. Server `media/cursor.ts` → thin re-export; `similar-paged.ts` import unchanged (via media barrel). Changeset minor (`@ent-mcp/shared`).
- **A2.** Consumer registration maps: `homeMediaSources` (thin — wrap `ROW_PROVIDERS` + add schema/cursor-policy/rate-limit) + `watchlistMediaSources` (new barrel export re-packaging `service.ts`-private source+cfg wiring, §A4). Exported via barrels. ⊥ endpoint yet; unit-test registry build.
- **A3.** `api/procedures/media.ts` resolver + mount `/api/media/sources/:sourceId` (additive). Carry rate limiters, eligibility, cursor-null mapping. Parity: resolver returns same items/order/cursor as old `/home/row` + `/watchlist/*` (fixtures captured from current endpoints before this phase).
- **A4.** Title resource `/api/media/:type/:tmdbId/details` + `/availability` → home composition (adapter bridge, B). ⊥ `/seasons` (rides in `details`).
- **A5.** `/api/media/{counts,moods}` + `POST|DELETE /api/media/watchlist` (adapter → watchlist/media barrels). Changeset minor (`@ent-mcp/server`).

**Part B — client**
- **B1.** `shared/media/` layer (source, hook core + 2 wrappers, `mediaKeys`, `MediaApiError`, cursor re-export). `similarTo` client cursor.
- **B2.** Shared `media-row-card` + `grid-skeleton`; empty-state wrappers; shared optimistic invalidation (#504/#505/#514).
- **B3.** Migrate watchlist (#506/#508/#509) + nits (#515/#516). Section parity in-browser checks (V.WL* pinned).
- **B4.** Migrate home (#507). Layout parity — rails render identically, no extra fetches.
- **B5.** Watchlist route loaders + `errorComponent` (#513).
- **B6.** Paraglide variants (#511/#512).
- **B7.** All-items virtual scroll (#519).

**Cutover**
- **Z.** Delete old `/home/{row,details,season-availability}` + all `/watchlist/*` (§A8); keep `/home/layout`; re-point router; regen `AppType`. Delete client dead shims/hooks/types. Fallow baseline ⊥ grow (Rule 14). Final `vp check` + `vp test`. Changeset minor (`@ent-mcp/server`, `@ent-mcp/client`).

## §E — Testing

- **Resolver unit:** unknown sourceId→404, ineligible→404, bad params→400, cursor-null mapping per `cursorOnNull` (home 400 / watchlist first-page), `requiresInitialCursor`→400. Rate-limit applied per registration.
- **Shared codec:** `decode→null` on bad/foreign/mode-mismatch (both modes); `encodeSeedCursor`/`decodeSeedToken` round-trip; client + server import the *same* module (no fork).
- **Registry:** every `MEDIA_SOURCE_IDS` entry resolves to a registration; `build` wires `listRows` with the right stages (V.MC1).
- **Read parity (epic: no behavior change):** ∀ source, resolver output = pre-refactor endpoint output (item ids/order/cursor) — fixtures captured from the live old endpoints before A3 (list sources) / A4 (title), asserted after.
- **Client:** `mediaRowsQueryOptions` flatten + `getNextPageParam` + `partial` OR-reduce; suspense vs lazy wrappers; one-shot `mediaKeys.root` invalidation on add/remove; `similarTo` cursor built client-side hits the resolver. Existing hook tests repoint to shared.
- **Adjacent:** loader prefetch + `errorComponent` (#513); paraglide variant selection (#511/#512); virtual window fetch-near-end (#519); nits #514/#515/#516 regression.

## §F — Risks

- **RISK-201** — generic resolver swallows per-source nuance (eligibility, cursor mode, rate limit, seed). Mitigate: `MediaSourceRegistration` carries each as an explicit field; resolver is dumb dispatch; registry unit test ∀ id.
- **RISK-202** — read parity drift (subtle cursor/sort/classify change vs hand-written endpoints). Mitigate: §E parity fixtures captured from live old endpoints before A3, asserted against the resolver; additive sequencing keeps old + new serving the same data in parallel until cutover Z — fixtures pin they agree before the old surface is deleted.
- **RISK-203** — URL/owner divergence on the title resource (URL `media`, logic `home`) confuses navigators. Mitigate: §A1 rule documented; adapter is a one-line bridge; no logic relocates.
- **RISK-204** — suspense (watchlist) vs lazy (home) reconciliation in one hook core leaks loading semantics. Mitigate: V.CL1 — shared *query-options*, two explicit wrappers; home keeps per-row skeleton, watchlist keeps section suspense.
- **RISK-205** — big PR train (A1–A5, B1–B7, cutover Z). Mitigate: phase-per-PR, parity-gated; B5–B7 (loaders/paraglide/virtual) splittable into their own follow-ups if the train stalls (⊥ blocking the core consolidation B1–B4).
- **RISK-206** — cursor invalidation on deploy (codec move + endpoint reshape). Accept (pre-stable, cursors are ephemeral React-Query cache state). Note in changeset.

## §G — Out of scope

`search` + `command-menu` (different read model). Moving `CompactMediaItem`'s *definition* (vs re-export) into `@ent-mcp/shared/media`. Generic write/aggregate collapse beyond namespace. Server module re-org (forbidden, §A1). Plugin dispatch, seed/sync lifecycle, hero/match-reason heuristics — unchanged.

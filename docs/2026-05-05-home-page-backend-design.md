# Home Page Backend

**Status:** Draft (rev 6)
**Date:** 2026-05-05 (rev 2: 2026-05-06, rev 3: 2026-05-06, rev 4: 2026-05-07, rev 5: 2026-05-22, rev 6: 2026-05-23)
**Author:** Omid Astaraki
**Deps:** `2026-04-20-job-service-design.md`, `2026-04-20-preference-engine-design.md`, `2026-04-27-catalog-service-design.md`, `2026-05-04-home-page-implementation-design.md`
**Amends §V:** TBD on backprop

## Revision history

- **rev 6 (2026-05-23)** — Warm-job per-row timeout (diag `runId d43fccf3-461e-4fc3-8918-5c5d4f13ad1a`, `host.home.layout_warm`). Root cause: `ctx.deadlineMs` set at compose entry but dropped by `enrichItems` leaves (`StatusBatchMemo.get`, `ArtworkService.getArtwork`, `MediaService.getMatchingServers`) and ignored as a clip on per-plugin `defaultTimeoutMs`. Worst plugin call ≈ 32 s (15 s `invokeWithTimeout` + 2 s rate-limit backoff + 15 s retry; transient branch = 31 s). Sequential compose phases compound past the 60 s per-row cap. Fix: thread `deadlineMs` through every leaf called from `composeLayout` AND `composeDetails` (incl. `composeDetails` cold-fill `getMetadata` and `getShowSeasons`); clip `invokeWithTimeout` to `min(capability.defaultTimeoutMs, remaining)`; reshape `buildContext` to accept `{ deadlineMs? }` opts; warm job sets `deadlineMs = now + 45_000` (15 s SQLite slack under 60 s row cap). Bust mode = fail-fast row via existing soft-failure path; partial layout written back. No wire-shape change; no `schema_version` bump.
- **rev 5 (2026-05-22)** — Cross-source dedup added to the hero mixer (issue #474). The rev 4 mixer keyed slide uniqueness by `${source}:${tmdbId}`, so the same title present in two source pools (e.g. trending + new releases) shipped as two hero slides. New `dedupePools` step runs between pool build and `drawByQuota`, drops cross-source duplicates keyed by `${mediaType}:${tmdbId}`, and lets the higher-priority source (`[CW, rec, trend, new]`) keep the slide. Quota / backfill / order logic unchanged; backfill simply sees shorter pools when duplicates collapse. No wire-shape change; no `schema_version` bump.
- **rev 4 (2026-05-07)** — Hero stops being a single-source cascade. Driven by §Amendment 3. `LayoutHero` reshapes to `{ slides: HeroSlide[] }`; each slide carries its own `source` + `reason` so the UI can label slides individually. Composer draws a fixed quota across the four sources (1 CW + 2 rec + 2 trend + 1 new = 6 slides) and cascades backfill by priority when a source is short. Slide order: cascade lead, then round-robin interleave of the rest. `home_layout_cache.schema_version` bumps 1 → 2. Pre-stable break — no compat shim.
- **rev 3 (2026-05-06)** — Doc-code sync. §Hero composition shows the `enrichItems` step shared with row enrichment. §Orchestrator `composeRow` adds eligibility gate (404 `home.row_unavailable` on direct ineligible access) and the soft-failure `try/catch` that converts `AllPluginsFailedError`/`PluginCallError`/`AbortError` to `partial:true`. Error codes in §Orchestrator `composeRow`/`composeDetails` align with the unified envelope (`home.row_unavailable`, `home.bad_input`, `http.not_found`, `home.internal`). §Architecture composeRow/composeDetails diagrams swap `enrich.attach*` for `enrichItems`.
- **rev 2 (2026-05-06)** — TV detail gains canonical season+episode list (in `getDetails`) + per-server episode presence via new RPC `home.getSeasonAvailability`. Driven by §Amendment 2. Adds `metadata@v1.getShowSeasons` + `libraryAvailability@v1.listShowEpisodes` on plugin SDK. UI: live read-only seasons accordion w/ Suspense + ErrorBoundary partial-failure microcopy. Implementation phases for amendment in `plan/feature-home-tv-seasons-1.md`.

## Summary

Replace `useHomeFeed()` mock w/ real backend. 3 RPCs: `home.getLayout`, `home.getRowContent(rowId, cursor)`, `home.getDetails(tmdbId, type)`. Each row = isolated `RowProvider` module → independent dev + per-row tests. Heavy lifting offloaded to existing services: `CatalogService` (sub-ms reads, nightly snapshots, rec lists), `MediaService` (live aggregates w/ `interpretAggregate` partial flag), `PreferenceEngine` (rank + topContributors). One new job `host.home.layout_warm` pre-computes per-user layout hourly → `home.getLayout` = 1 PK read on warm path. Wire reshape (CompactMediaItem.matchReason → typed; HomeRowStub +kind/slug; +availability/facets/seriesContext) — pre-stable project, ⊥ compat shims.

## Goals

- ⊥ mock → real serve. Replace `MOCK_FEED` w/ real RPC w/o UI rewrite.
- Row pipelines isolated. New/edit row = single file + test, ⊥ touch others.
- Mock-parity wire fields (availability, facets, matchReasonKey, seriesContext) on `CompactMediaItem`.
- `home.getLayout` warm path ≤ 50 ms (1 PK read of `home_layout_cache` blob).
- `home.getRowContent` ≤ 5 s w/ partial-flag fallback on plugin slowness.
- `home.getDetails` reuses dispatch-cache; ⊥ new persistence v1.
- Hero cascade live (continueWatching → rec list → trending → newReleases) w/ alternates from same source.
- Match-reason typed for i18n; row-context-aware key selection.
- `partial: true` row flag on aggregate failure (≥1 plugin err, ≥1 succeeded).
- Per-row test required. CI enforces via fallow zone + colocated `__tests__/`.

## Non-goals

- ⊥ request flow. Status badges + availability shown only; submit/pick handled next phase.
- ~~⊥ per-season/per-episode availability~~ — **rev 2 promotes to in-scope.** TV detail returns canonical seasons in `getDetails`; per-server episode presence in new `home.getSeasonAvailability` RPC. Per-season _requesting_ still next-phase.
- ⊥ `tags` (4K/HDR/Atmos). Wire field reserved; populated when media-features capability lands.
- ⊥ `facets.monochrome`. Drop from type — zero readers.
- ⊥ MCP surface change. PE prose stays for `mcp/composite-tools/ent-discover.ts`.
- ⊥ row reordering per-user. Static order from registry.
- ⊥ multi-locale on server today. `titleKey`/`subtitleKey` = i18n key strings; client resolves via Paraglide. Server ⊥ render.
- ⊥ websocket / SSE invalidation. Cache TTL only v1.
- ⊥ Postgres swap. SQLite v1; Drizzle abstracts.
- ⊥ `LayoutHero.resumeUrl` resolution v1. Plugin SDK has no `playback@v1.getResumeUrl` method (only `getPositions` + `removePosition`). Wire field stays as `string | null`; orchestrator always emits `null` v1. UI renders Play as nav-to-detail. Add resolver when SDK gains `getResumeUrl` (own design pass).

## Architecture

```
[client] ─ home.getLayout ──► home/orchestrator.composeLayout(ctx)
                              ├─ layout-cache.read(userId)        — sub-ms PK
                              │     hit fresh → return blob
                              │     miss/stale → fall through
                              ├─ ROW_PROVIDERS.values().forEach
                              │     → provider.eligibility(ctx)   — Promise.allSettled, parallel
                              ├─ hero.pickHero(ctx)               — cascade
                              ├─ status-batch.warm(ctx, heroId)
                              └─ assemble HomeLayoutResponse + write back to cache (fire-and-forget)

[client] ─ home.getRowContent(rowId, cursor) ──► home/orchestrator.composeRow(ctx, rowId, cursor)
                              ├─ provider = ROW_PROVIDERS[rowId]   — registry lookup
                              ├─ provider.eligibility(ctx)         — direct-access gate, 404 home.row_unavailable on false
                              ├─ provider.fetchPage(ctx, cursor)   — row-local pipeline
                              │     soft failure → partial:true + items:[]
                              ├─ enrichItems(page.items, ctx)      — status, availability, facets, matchReason
                              └─ return RowContentResponse

[client] ─ home.getDetails(tmdbId,type) ──► home/orchestrator.composeDetails(ctx)
                              ├─ summary  = catalog.getMetadata    — sub-ms (cold-fill on miss via mediaService.getMetadata)
                              ├─ details  = mediaService.getDetails — dispatch-cached
                              ├─ if type=tv: seasons = mediaService.getShowSeasons(tmdbId)  — dispatch-cached (rev 2)
                              ├─ enrichItems([summary], ctx, "details")  — status, availability, facets
                              └─ return { summary, details, error?: { code } }

[client] ─ home.getSeasonAvailability(tmdbId) ──► home/orchestrator.composeSeasonAvailability(ctx)  — rev 2
                              ├─ resolveConnections(libraryAvailability@v1, user)
                              ├─ Promise.allSettled per connection:
                              │     dispatch listShowEpisodes({ id: tmdbId, idType: "tmdb" })
                              ├─ bucket flat episodes → seasons map per server
                              ├─ rejected settles → push to errors[]
                              └─ return { servers: SeasonAvailabilityServer[], errors?: SeasonAvailabilityError[] }

[job] host.home.layout_warm (hourly, scheduled_per_row) ──► layout-cache.write(userId, blob)
```

`RowProvider` registry = sole row authority. Orchestrator agnostic re row-specific source.

## Wire contracts (`@ent-mcp/shared/home`)

### `enums.ts`

```ts
export const ROW_KINDS = [
  "continueWatching",
  "recommendedForYou",
  "trendingNow",
  "newReleases",
  "becauseYouWatched",
  "upcomingForYou",
  "yourWatchlist",
] as const;
export type RowKind = (typeof ROW_KINDS)[number];

export const HERO_REASONS = [
  "continue_watching",
  "recommended",
  "trending",
  "new_release",
] as const;
export type HeroReason = (typeof HERO_REASONS)[number];

// NEW — typed match-reason keys mirroring UI tuple.
export const MATCH_REASON_KEYS = [
  "matches_recent_picks",
  "from_genre_you_love",
  "similar_to_seed",
  "because_in_watchlist",
  "continuing_series",
  "upcoming_release",
  "recently_added",
  "highly_rated",
  "from_active_series",
  "finishing_soon",
] as const;
export type MatchReasonKey = (typeof MATCH_REASON_KEYS)[number];
```

### `types.ts`

```ts
export interface MatchReason {
  key: MatchReasonKey;
  params: Record<string, string>; // ICU placeholders, server-supplied
}

export interface Availability {
  hasAnyServerCopy: boolean;
  requestEligible: boolean;
  servers: { id: string; label: string }[]; // e.g. [{id:"plex", label:"Plex"}]
}

export interface Facets {
  runtimeMin?: number;
  episodeCount?: number;
  releaseDate?: string; // ISO date | human-formatted; server picks
}

export interface SeriesContext {
  season: number;
  episode: number;
  episodeTitle: string;
  nextUpFromServer: boolean; // true when stitched via continueWatching nextUp
}

export interface CompactMediaItem {
  id: string; // "movie:550" | "tv:1396"
  tmdbId: string;
  mediaType: "movie" | "tv";
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  clearLogo?: string;
  overview?: string;
  genres?: string[];
  rating?: number;
  userRating?: number;
  progress?: { watched: number; total: number };
  episodeProgress?: { watched: number; total: number };
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  availability?: Availability; // NEW
  facets?: Facets; // NEW
  seriesContext?: SeriesContext; // NEW
  episode?: { season: number; episode: number; airsAt: number; name?: string };
  matchReason?: MatchReason; // CHANGED string → MatchReason
  tags?: string[]; // RESERVED v1 — undefined; populated by future capability
}

export interface HomeRowStub {
  rowId: string; // CHANGED — unique slug, e.g. "recommendedForYou-tv"
  kind: RowKind; // NEW — display category
  titleKey: string; // i18n key
  subtitleKey?: string;
  initialCursor: string | null;
}

// rev 4 — hero is a list of mixed-source slides. UI auto-rotates; slides[0] is the lead.
export interface HeroSlide {
  item: CompactMediaItem;
  source: RowKind; // continueWatching | recommendedForYou | trendingNow | newReleases
  reason: HeroReason; // matches source: continue_watching | recommended | trending | new_release
  resumeUrl: string | null; // populated only for source="continueWatching"; null v1 (see R2)
}

export interface LayoutHero {
  slides: HeroSlide[]; // 1..6, ordered; null LayoutHero only when every source empty
}

export interface HomeLayoutResponse {
  hero: LayoutHero | null;
  rows: HomeRowStub[];
  generatedAt: number; // ms epoch
}

export interface RowContentResponse {
  items: CompactMediaItem[];
  cursor: string | null; // null = end
  partial?: true;
}

// NEW — getDetails surface.
export interface MediaDetailsExtra {
  cast: string[];
  director?: string;
  ageRating?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  trailerUrl?: string;
  nextAirDate?: string;
  seriesStatus?: "ongoing" | "finished";
  runtime?: string; // formatted "1h 58m"
  seasons?: SeasonInfo[]; // rev 2 — tv-only; absent for movie + when canonical fetch fails
}

export interface MediaDetailsResponse {
  summary: CompactMediaItem;
  details: MediaDetailsExtra | null; // null when plugin err; UI shows summary only
  error?: { code: HostErrorCode }; // present iff details=null
}

// rev 2 — canonical season+episode list, sourced via metadata@v1.getShowSeasons.
export interface SeasonEpisodeInfo {
  episodeNumber: number;
  title: string;
  airDate?: string; // ISO date
  runtime?: number; // minutes
}

export interface SeasonInfo {
  seasonNumber: number; // 0 = Specials
  name: string;
  airDate?: string;
  totalEpisodes: number;
  episodes: SeasonEpisodeInfo[];
}

// rev 2 — per-server episode presence, from libraryAvailability@v1.listShowEpisodes.
// Wire ships flat `{ season, episode }` pairs (PR #202): plugin returns the
// raw episode list its HTTP endpoint already produces, host bypasses the
// per-season bucketing on serialization, and the client buckets to seasons
// at render time. Avoids duplicating the bucketing logic in two plugins
// (Plex /allLeaves + Jellyfin /Shows/{id}/Episodes already enumerate all
// eps in one call).
export interface SeasonAvailabilityServer {
  serverId: string; // `${pluginId}:${connectionId}` (or pluginId for shared pool)
  serverLabel: string; // plugin displayName
  episodesPresent: { season: number; episode: number }[]; // sorted (season, episode) ascending
}

export interface SeasonAvailabilityError {
  serverId: string;
  serverLabel: string;
  code: HostErrorCode;
}

export interface SeasonAvailabilityResponse {
  servers: SeasonAvailabilityServer[];
  errors?: SeasonAvailabilityError[];
}
```

### `schemas.ts`

```ts
export const homeGetLayoutInputSchema = z.object({}).strict();

export const homeGetRowContentInputSchema = z
  .object({
    rowId: z.string().min(1), // any registered slug
    cursor: z.string().nullable(),
  })
  .strict();

export const homeGetDetailsInputSchema = z
  .object({
    tmdbId: z.string().min(1),
    mediaType: z.enum(["movie", "tv"]),
  })
  .strict();

// rev 2 — per-server episode-presence query for TV titles.
export const homeGetSeasonAvailabilityInputSchema = z
  .object({ tmdbId: z.string().min(1) })
  .strict();
```

## RowProvider abstraction

```
home/types.ts:
  RowProvider {
    rowId      string
    kind       RowKind
    titleKey   string
    subtitleKey? string
    eligibility(ctx)            → Promise<boolean>
    initialCursor(ctx)          → Promise<string|null>
    fetchPage(ctx, cursor)      → Promise<{ items: CompactMediaItem[]; cursor: string|null; partial: boolean }>
  }

  RowContext {
    userId         string
    mediaService   MediaService          // per-user instance
    catalog        CatalogService        // singleton
    pe             PreferenceEngine
    dataloader     DataLoader
    deadlineMs?    number
    statusBatch    StatusBatchMemo       // request-scoped
    logger         Logger
  }
```

**Invariant (rev 6).** Every leaf called from `composeLayout` OR `composeDetails` MUST accept and honor `deadlineMs`. Explicit leaf set:

- Plugin invoke (`invokeWithTimeout` — additionally clips its own `timeoutMs` to `min(capability.defaultTimeoutMs, remaining)`).
- `StatusBatchMemo.get(ids, { deadlineMs })` → forwards to `mediaRequest@v1.getStatusBatch` dispatch.
- `ArtworkService.getArtwork(requests, languages?, { deadlineMs? })` → forwards into the artwork `dispatchAggregatePerKind` request (the strategy already plumbs `req.deadlineMs` to `invokeOne`; only `ArtworkService.getArtwork`'s own signature gap remains).
- `MediaService.getMatchingServers(tmdbId, mediaType, { deadlineMs })` (new options arg; currently missing).
- `MediaService.getShowSeasons(tmdbId, { deadlineMs })` (called from `composeDetails`; currently missing).
- `MediaService.getMetadata(tmdbId, mediaType, { deadlineMs })` cold-fill path in `composeDetails`.
- Every `RowProvider.fetchPage(ctx, cursor)` (already in place via `ctx.deadlineMs`).

`buildContext` signature reshapes to `buildContext(userId, logger?, opts?: { deadlineMs? })`. HTTP request path defaults to `now + 8_000`; warm job sets `now + 45_000`. Leaves added under `home/internal/` or wired from `enrich.ts` without honoring `deadlineMs` fail review.

```
home/rows/index.ts:
  export const ROW_PROVIDERS: Record<string, RowProvider> = {
    "continueWatching-active":    require("./continue-watching-active").default,
    "continueWatching-next":      require("./continue-watching-next").default,
    "becauseYouWatched":          require("./because-you-watched").default,
    "recommendedForYou-tv":       require("./recommended-for-you-tv").default,
    "recommendedForYou-movies":   require("./recommended-for-you-movies").default,
    "yourWatchlist":              require("./your-watchlist").default,
    "upcomingForYou":             require("./upcoming-for-you").default,
    "trendingNow":                require("./trending-now").default,
    "newReleases":                require("./new-releases").default,
    "similarTo":                  require("./similar-to").default,    // detail-page only
  };
  // Static layout order for the home feed. `similarTo` is reachable via
  // `composeRow` from the media detail page but never appears in the home
  // layout, so it is excluded from ROW_ORDER.
  export const ROW_ORDER: string[] = [
    "continueWatching-active", "continueWatching-next", "becauseYouWatched",
    "recommendedForYou-tv", "recommendedForYou-movies", "yourWatchlist",
    "upcomingForYou", "trendingNow", "newReleases",
  ];
```

Adding row = drop file in `rows/`, register in `index.ts`, write test in `__tests__/`. ⊥ touch orchestrator.

## Per-row pipelines

```
rows/continue-watching-active.ts:
  rowId         "continueWatching-active"
  kind          "continueWatching"
  titleKey      "home_row_continueWatching_header"
  eligibility   ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user")
  initialCursor null
  fetchPage(ctx, cursor):
    page = decodeCursor(cursor) ?? { offset: 0 }
    res = ctx.mediaService.getContinueWatchingFeed({ deadlineMs: ctx.deadlineMs })
    entries = res.items.filter(e => e.progressMs > 0 && progress(e) < 0.85)
    sorted  = orderBy(entries, [e=>e.lastPlayedAt], ["desc"])
    slice   = sorted.slice(page.offset, page.offset + 12)
    items   = slice.map(toCompactMediaItem)              // utils/adapt-cw-entry
    next    = sorted.length > page.offset + 12 ? encode({ offset: page.offset + 12 }) : null
    return { items, cursor: next, partial: res.partial }

rows/continue-watching-next.ts:
  rowId         "continueWatching-next"
  kind          "continueWatching"
  titleKey      "home_row_nextInYourShows_header"
  subtitleKey   "home_row_nextInYourShows_subtitle"
  eligibility   ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user")
  initialCursor null
  fetchPage(ctx, cursor):
    res = ctx.mediaService.getContinueWatchingFeed({ deadlineMs: ctx.deadlineMs })
    entries = res.items.filter(e => e.nextUp || e.progressMs == null)
    items   = entries.map(e => toCompactMediaItem(e.nextUp ?? e.item, { nextUpFromServer: !!e.nextUp }))
    return { items: items.slice(0, 12), cursor: null, partial: res.partial }
                                                          // bounded → single page

rows/because-you-watched.ts:
  rowId         "becauseYouWatched"
  kind          "becauseYouWatched"
  titleKey      "home_row_becauseYouWatched_header"
  subtitleKey   "home_row_becauseYouWatched_subtitle"
  eligibility:
    history = catalog.getUserHistory(userId)
    return history.length > 0 && hasCapabilityProvider("metadata","v1","user")
  initialCursor:
    seed = pickSeed(history)                              // last completed, prefer high-rated
    return encode({ seedId: seed.tmdbId, seedType: seed.mediaType, offset: 0 })
  fetchPage(ctx, cursor):
    page = decodeCursor(cursor)                           // {seedId, seedType, offset}
    res  = ctx.mediaService.getSimilarFeed({ id: page.seedId, type: page.seedType, deadlineMs })
    slice = res.items.slice(page.offset, page.offset + 12)
    items = slice.map(toCompactMediaItem).map(addSeedToParams(seedTitle))
    next  = res.items.length > page.offset + 12 ? encode({...page, offset: page.offset + 12}) : null
    return { items, cursor: next, partial: res.partial }
    // NOTE: cursor=null on this row is invalid (seed required). Orchestrator validates via
    // provider.requiresInitialCursor=true; rejects null cursor w/ HttpError 400 "cursor_required".

rows/recommended-for-you-tv.ts:
  rowId         "recommendedForYou-tv"
  kind          "recommendedForYou"
  titleKey      "home_row_tvShowsToRequest_header"
  eligibility:
    rec = catalog.getRecommendations(userId, "default")
    return rec != null && rec.items.some(i => i.media_type === "tv")
  initialCursor null
  fetchPage(ctx, cursor):
    page = decodeCursor(cursor) ?? { offset: 0 }
    rec  = catalog.getRecommendations(userId, "default")
    pool = rec.items.filter(i => i.media_type === "tv")
    statuses = ctx.statusBatch.get(pool.map(p => `${p.mediaType}:${p.tmdbId}`))
    pool2    = pool.filter(p => statuses[`${p.mediaType}:${p.tmdbId}`] !== "available")
    // mediaRequest@v1.getStatusBatch keys on composite "type:tmdbId" ids.
    keys     = pool2.slice(page.offset, page.offset + 12)
    mdKeys   = keys.map(k => ({ tmdbId: k.tmdbId, type: k.mediaType }))   // CatalogService.getMetadataBatch shape
    metadata = catalog.getMetadataBatch(mdKeys)
    items    = keys.map(k => toCompactMediaItem(metadata[k.tmdbId], { topContributors: k.topContributors }))
    next     = pool2.length > page.offset + 12 ? encode({ offset: page.offset + 12 }) : null
    return { items, cursor: next, partial: false }       // catalog read ⊥ partial

rows/recommended-for-you-movies.ts:
  // mirror of -tv w/ media_type === "movie"; titleKey = "home_row_moviesToRequest_header"

rows/your-watchlist.ts:
  rowId         "yourWatchlist"
  kind          "yourWatchlist"
  titleKey      "home_row_yourWatchlist_header"
  eligibility   hasCapabilityProvider("watchlist","v1","user")
  initialCursor null
  fetchPage(ctx):
    res    = ctx.mediaService.getWatchlistFeed({ deadlineMs })
    keys   = res.items.map(toWatchlistKey).filter(Boolean)        // {tmdbId,type,fallbackTitle?,fallbackYear?}
    // Filter to titles the user can already play. mediaRequest@v1.getStatusBatch
    // only flags items that flowed through the request pipeline (Seerr); a watchlist
    // title added directly to Jellyfin returns `unknown` and the row would silently
    // drop it. getMatchingServers walks libraryAvailability@v1 providers — the actual
    // presence signal — and is per-request memoized.
    present = await Promise.all(keys.map(async k =>
      (await ctx.mediaService.getMatchingServers(k.tmdbId, k.type).catch(()=>[])).length > 0 ? k : null))
    avail   = present.filter(Boolean).slice(0, 12)
    metadata = ctx.catalog.getMetadataBatch(avail.map(k => ({ tmdbId: k.tmdbId, type: k.type })))
    items    = avail.map(k => metadata[`${k.type}:${k.tmdbId}`]
      ? fromCanonicalMetadata(metadata[`${k.type}:${k.tmdbId}`])                // catalog hit
      : k.fallbackTitle ? { id:`${k.type}:${k.tmdbId}`, tmdbId:k.tmdbId, mediaType:k.type, title:k.fallbackTitle, year:k.fallbackYear } // catalog cold → stub
      : null).filter(Boolean)
    return { items, cursor: null, partial: res.partial }

rows/upcoming-for-you.ts:
  rowId         "upcomingForYou"
  kind          "upcomingForYou"
  titleKey      "home_row_upcomingForYou_header"
  eligibility   hasCapabilityProvider("calendar","v1","user")
  fetchPage(ctx):
    res = ctx.mediaService.getUpcomingFeed({ deadlineMs })
    items = res.items.slice(0, 12).map(toCompactMediaItem)
    return { items, cursor: null, partial: res.partial }

rows/trending-now.ts:
  rowId         "trendingNow"
  kind          "trendingNow"
  titleKey      "home_row_trendingNow_header"
  eligibility:
    snap = catalog.getDiscoverFeed("trending", "popularity_desc", today())
    return snap != null && snap.length > 0
  fetchPage(ctx, cursor):
    page = decodeCursor(cursor) ?? { offset: 0 }
    snap = catalog.getDiscoverFeed("trending", "popularity_desc", today())
    keys = snap.slice(page.offset, page.offset + 12)
    metadata = catalog.getMetadataBatch(keys)
    items    = keys.map(k => toCompactMediaItem(metadata[k.tmdb_id]))
    next     = snap.length > page.offset + 12 ? encode({ offset: page.offset + 12 }) : null
    return { items, cursor: next, partial: false }

rows/new-releases.ts:
  // mirror of trending-now w/ feed_kind="newReleases", sort="release_date_asc"
```

## Hero composition

Mixed-source composer (rev 5). Replaces the previous first-non-empty cascade. Draws a fixed quota across all four sources, backfills short slots by priority, then orders cascade-lead-then-interleave so the lead is always the highest-priority non-empty source while the body alternates for variety. Pools are deduped across sources by `${mediaType}:${tmdbId}` before the quota draw (rev 5), with the higher-priority source winning, so the same title can never appear in two hero slides.

```
home/hero.ts:
  HERO_TARGET = 6
  POOL_SIZE   = 6                                        // each loader returns up to 6 candidates
  QUOTA: Record<RowKind, number> = {
    continueWatching:   1,
    recommendedForYou:  2,
    trendingNow:        2,
    newReleases:        1,
  }
  PRIORITY: RowKind[] = ["continueWatching", "recommendedForYou", "trendingNow", "newReleases"]

  pickHero(ctx) → LayoutHero | null
    pools = await Promise.all(PRIORITY.map(src => loadPool(src, ctx)))   // HeroSlide[] each
    rawPoolsByKind = zip(PRIORITY, pools)
    poolsByKind    = dedupePools(rawPoolsByKind, PRIORITY)                // drop cross-source dupes (rev 5)
    drafts = drawByQuota(poolsByKind, QUOTA)             // top-N from each pool (no enrichItems yet)
    filled = backfill(drafts, poolsByKind, HERO_TARGET, PRIORITY)
    if filled.length === 0: return null
    ordered = orderCascadeLeadInterleave(filled, PRIORITY)
    enriched = await enrichItems(ordered.map(s => s.item), ctx, { rowId: "hero" })
    slides = ordered.map((s, i) => ({ ...s, item: enriched[i], resumeUrl: resolveResumeUrl(s) }))
    return { slides }

  loadPool(source, ctx) → Promise<HeroSlide[]>
    // Each loader stamps source + reason on every candidate it returns. Pool size capped at
    // POOL_SIZE so backfill has headroom without unbounded fetches.
    switch source:
      case "continueWatching":  return loadContinueWatchingPool(ctx)
      case "recommendedForYou": return loadRecommendedPool(ctx)
      case "trendingNow":       return loadTrendingPool(ctx)
      case "newReleases":       return loadNewReleasesPool(ctx)

  dedupePools(poolsByKind, priority) → PoolMap          // rev 5
    seen = new Set<string>()
    out  = {}
    for src of priority:                                 // CW → rec → trend → new
      out[src] = poolsByKind[src].filter(s => {
        key = `${s.item.mediaType}:${s.item.tmdbId}`
        if (seen.has(key)) return false
        seen.add(key); return true
      })
    return out                                           // within each pool, draw order is preserved

  drawByQuota(poolsByKind, quota) → HeroSlide[]
    out = []
    for src of PRIORITY:                                 // deterministic priority walk
      take = min(poolsByKind[src].length, quota[src])
      out.push(...poolsByKind[src].slice(0, take))
    return out

  backfill(drafts, poolsByKind, target, priority) → HeroSlide[]
    used = new Set(drafts.map(s => `${s.source}:${s.item.tmdbId}`))
    while drafts.length < target:
      progressed = false
      for src of priority:                               // CW → rec → trend → new
        next = poolsByKind[src].find(s => !used.has(`${src}:${s.item.tmdbId}`))
        if next:
          drafts.push(next); used.add(`${src}:${next.item.tmdbId}`); progressed = true
          if drafts.length === target: break
      if !progressed: break                              // every pool exhausted; ship < target
    return drafts

  orderCascadeLeadInterleave(slides, priority) → HeroSlide[]
    byKind = groupBy(slides, s => s.source)              // preserves draw order within group
    lead = null
    for src of priority:
      q = byKind[src] ?? []
      if q.length: { lead = q.shift(); break }
    if !lead: return slides
    rest = []
    while priority.some(k => (byKind[k]?.length ?? 0) > 0):
      for src of priority:
        q = byKind[src]
        if q?.length: rest.push(q.shift())
    return [lead, ...rest]

  loadContinueWatchingPool(ctx) → HeroSlide[]
    if !(await ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user")): return []
    res = await ctx.mediaService.getContinueWatchingFeed({ deadlineMs })
    eligible = res.items.filter(e => e.progressMs > 0 && progress(e) < 0.85)
    sorted   = orderBy(eligible, [e => e.lastPlayedAt], ["desc"])
    items    = sorted.slice(0, POOL_SIZE).map(fromContinueWatchingEntry).filter(Boolean)
    return items.map(item => ({ item, source: "continueWatching",
                                reason: "continue_watching", resumeUrl: null }))

  loadRecommendedPool(ctx) → HeroSlide[]
    rec = await catalog.getRecommendations(userId, "default")
    if !rec || rec.items.length === 0: return []
    keys = rec.items.slice(0, POOL_SIZE)
    md   = await catalog.getMetadataBatch(keys.map(k => ({ tmdbId: k.tmdbId, type: k.mediaType })))
    return keys.flatMap(k => {
      meta = md[`${k.mediaType}:${k.tmdbId}`]
      if !meta: return []
      return [{ item: fromCanonicalMetadata(meta, { topContributors: k.topContributors }),
                source: "recommendedForYou", reason: "recommended", resumeUrl: null }]
    })

  loadTrendingPool(ctx) → HeroSlide[]      // mirror, feed_kind="trending",  reason="trending"
  loadNewReleasesPool(ctx) → HeroSlide[]   // mirror, feed_kind="newReleases", reason="new_release"

  resolveResumeUrl(slide) → string | null
    return null    // v1 — playback@v1 has no getResumeUrl method (only getPositions/removePosition).
                   // Hero Play button = nav-to-detail v1. See §Non-goals + R2. Stays per-slide so a
                   // future SDK addition only populates CW slides without touching the wire shape.
```

**Worked example — full installation** (CW=3, recs=10, trending=10, new=8):

- Draw quota → [CW#1, rec#1, rec#2, trend#1, trend#2, new#1] (6 already)
- No backfill needed
- Lead = CW#1 (highest priority non-empty), rest interleaves: rec, trend, new, rec, trend
- Final order: [CW#1, rec#1, trend#1, new#1, rec#2, trend#2]

**Worked example — new user** (CW=0, recs=10, trending=10, new=8):

- Draw quota → [rec#1, rec#2, trend#1, trend#2, new#1] (5)
- Backfill 1 short: priority cascade hits rec pool first → +rec#3
- Final order: lead = rec#1 (CW empty so first non-empty by priority); rest: trend#1, new#1, rec#2, trend#2, rec#3
- Final order: [rec#1, trend#1, new#1, rec#2, trend#2, rec#3]

**Worked example — only CW populated** (CW=4, others empty):

- Draw quota → [CW#1] (1)
- Backfill 5 short: only CW pool has supply → CW#2..CW#4 added (3 more), then exhausted
- Final length: 4 slides, all CW. Acceptable degenerate case; UI still rotates 4 slides.

**Worked example — cross-source duplicate** (CW=0, recs=4 `[r1,r2,r3,r4]`, trending=2 `[dup,t2]`, new=1 `[dup]`):

- Dedup: `dup` first seen in trending → kept on trending; dropped from new (lower priority). Pools collapse to recs=4, trending=2, new=0.
- Draw quota → [r1, r2, dup, t2] (4 — new pool empty after dedup)
- Backfill 2 short: cascade hits recs → +r3, +r4
- Final order: lead = r1 (CW empty so first non-empty by priority); remainder interleaves rotated priority `[trend, new, CW, rec]` over `{rec=[r2,r3,r4], trend=[dup,t2]}` → `[r1, dup, r2, t2, r3, r4]`
- `dup` appears exactly once, sourced from `trendingNow`. No `newReleases` slide for `dup`.

## Layout cache

```
db/schema/home.ts:
  home_layout_cache
  ├── user_id        text PRIMARY KEY        FK → user.id
  ├── schema_version integer NOT NULL        -- bump on HomeLayoutResponse/HomeRowStub/LayoutHero shape change
  ├── blob           text NOT NULL           -- JSON HomeLayoutResponse minus generatedAt
  ├── generated_at   integer NOT NULL
  └── INDEX(generated_at)                    -- prune sweep

  TTL = 60 min. Stale → fall through to live composition + write-back.
  schema_version mismatch on read → discard, treat as cold.
  Job host.home.layout_warm runs hourly per active user (active = activity in last 14d).

  CURRENT_SCHEMA_VERSION = 2   // rev 4 — bumped from 1 on LayoutHero reshape
```

```
home/layout-cache.ts:
  STALE_MS = 60 * 60 * 1000
  CURRENT_SCHEMA_VERSION = 2

  read(userId) → { blob, generatedAt } | null
    row = db.select().from(homeLayoutCache).where(eq(user_id, userId)).get()
    if !row: return null
    if row.schema_version !== CURRENT_SCHEMA_VERSION: return null   // discard stale-shape blob (v1 → v2 on rev 4 deploy)
    return { blob: JSON.parse(row.blob), generatedAt: row.generated_at }

  isFresh(generatedAt) → bool
    return now() - generatedAt < STALE_MS

  write(userId, response)
    db.insert(homeLayoutCache).values({
        user_id,
        schema_version: CURRENT_SCHEMA_VERSION,
        blob: JSON.stringify(response),
        generated_at: now()
      })
      .onConflictDoUpdate({
        target: user_id,
        set: { schema_version: CURRENT_SCHEMA_VERSION, blob, generated_at: now() }
      })
```

## Orchestrator

```
home/orchestrator.ts:
  composeLayout(ctx):
    cached = layoutCache.read(ctx.userId)
    if cached && layoutCache.isFresh(cached.generatedAt):
      return cached.blob

    // Live compose.
    [eligibilities, hero] = await Promise.all([
      Promise.allSettled(ROW_ORDER.map(rowId =>
        ROW_PROVIDERS[rowId].eligibility(ctx).then(e => ({ rowId, eligible: e })))),
      pickHero(ctx),
    ])
    rows = []
    for (rowId of ROW_ORDER):
      r = eligibilities.find(e => e.rowId === rowId)
      if r?.value?.eligible !== true: continue            // settled-rejected drops too
      provider = ROW_PROVIDERS[rowId]
      rows.push({
        rowId,
        kind:        provider.kind,
        titleKey:    provider.titleKey,
        subtitleKey: provider.subtitleKey,
        initialCursor: await provider.initialCursor(ctx),
      })
    blob = { hero, rows, generatedAt: now() }
    void layoutCache.write(ctx.userId, blob).catch(log)   // detached
    return blob

  composeRow(ctx, rowId, cursor):
    provider = ROW_PROVIDERS[rowId]
    if !provider: throw HttpError(404, "home.row_unavailable")
    // Direct row access bypasses layout assembly, so re-run the eligibility
    // gate. Without this, a client requesting a row whose capability/data is
    // absent gets `200 + items: []`, masking misconfiguration.
    eligible = await provider.eligibility(ctx).catch(() => false)
    if !eligible: throw HttpError(404, "home.row_unavailable")
    if provider.requiresInitialCursor && cursor === null:
      throw HttpError(400, "home.bad_input", "cursor_required")
    // Per §Error handling: per-row plugin failures collapse to `partial: true`
    // with an empty item list rather than crashing the request. The soft-fail
    // check runs first because `AllPluginsFailedError` is now an `HttpError`
    // subclass (503 / `media.providers_failed`); any other HttpError or
    // unexpected throw still propagates to `errorHandler`.
    try:
      page = await provider.fetchPage(ctx, cursor)
    catch err:
      if isRowSoftFailure(err):                         // AllPluginsFailedError, PluginCallError, AbortError
        page = { items: [], cursor: null, partial: true }
      else: throw err                                   // HttpError + anything else
    enriched = await enrichItems(page.items, ctx, { rowId })   // status, availability, facets, matchReason
    return { items: enriched, cursor: page.cursor, partial: page.partial || undefined }

  composeDetails(ctx, tmdbId, type):
    summary = await catalog.getMetadata(tmdbId, type)            // CanonicalMetadata | null
    if !summary:                                                  // cold-fill
      raw = await mediaService.getMetadata(tmdbId, type)          // RawCanonicalSource — wire-only shape
      if !raw: throw HttpError(404, "http.not_found")
      await catalog.writeMetadata([toCanonicalRow(raw)])          // AWAIT — need canonical shape next
      summary = await catalog.getMetadata(tmdbId, type)           // refetch as CanonicalMetadata
      if !summary: throw HttpError(500, "home.internal")
    summaryInternal = fromCanonicalMetadata(summary)
    // Pipe the canonical summary through the same enrichment surface as row
    // items so detail responses carry status + availability + facets.
    [detailsSettled, [summaryItem]] = await Promise.all([
      mediaService.getDetails(tmdbId, type).then(ok, fail),       // {ok:true,data} | {ok:false,err}
      enrichItems([summaryInternal], ctx, { rowId: "details" }),
    ])
    if !summaryItem: throw HttpError(500, "home.internal")
    if !detailsSettled.ok:
      return { summary: summaryItem, details: null, error: { code: classifyError(detailsSettled.err) } }
    return { summary: summaryItem, details: toMediaDetailsExtra(detailsSettled.data) }

  isRowSoftFailure(err):
    // Per-row failures that should mark the row partial rather than crash the
    // request. PluginCallError covers single-strategy dispatch failures (the
    // fan-out aggregate AllPluginsFailedError covers multi-plugin) and
    // AbortError covers request-deadline cancellation.
    return err instanceof AllPluginsFailedError
        || err instanceof PluginCallError
        || (err instanceof Error && err.name === "AbortError")
```

## Match-reason resolver

```
home/match-reason.ts:
  pickMatchReason(rowId, item, ctx) → MatchReason | null
    switch (rowId):
      case "continueWatching-active":
        if progressFraction(item) >= 0.85: return { key: "finishing_soon", params: {} }
        return { key: "matches_recent_picks", params: { n: String(ctx.recentPickCount ?? 4) } }
      case "continueWatching-next":
        if item.seriesContext?.nextUpFromServer: return { key: "from_active_series", params: {} }
        return { key: "continuing_series", params: {} }
      case "becauseYouWatched":
        return { key: "similar_to_seed", params: { seedTitle: ctx.seedTitle ?? "" } }
      case "recommendedForYou-tv":
      case "recommendedForYou-movies":
        return mapTopContributor(item.__topContributors)  // see below
      case "yourWatchlist":
        if recentlyAdded(item): return { key: "recently_added", params: {} }
        return { key: "because_in_watchlist", params: {} }
      case "upcomingForYou": return { key: "upcoming_release", params: {} }
      case "trendingNow":    return null                   // chip hidden
      case "newReleases":    return null
    return null

  mapTopContributor(contribs) → MatchReason
    if !contribs || contribs.length === 0:
      return { key: "highly_rated", params: {} }           // fallback
    top = contribs[0]
    switch top.category:
      case "genre":    return { key: "from_genre_you_love", params: { genre: top.value } }
      case "person":
      case "keyword":
      case "decade":
      case "language":
      case "runtime":  return { key: "matches_recent_picks", params: { n: String(contribs.length) } }
      default:         return { key: "highly_rated", params: {} }
```

`item.__topContributors` injected by `recommended-for-you-{tv,movies}` from catalog rec list snapshot. Stripped before serialize.

## Status batch + enrichment

```
home/status-batch.ts:
  class StatusBatchMemo {
    private cache = new Map<string, "available"|"requested"|"processing"|"unavailable"|"unknown">()
    private pending = new Set<string>()

    constructor(private mediaService: MediaService)

    async get(ids: string[]) → Record<string, status>:
      missing = ids.filter(id => !this.cache.has(id) && !this.pending.has(id))
      if missing.length > 0:
        missing.forEach(id => this.pending.add(id))
        result = await mediaService.getStatusBatch(missing)
        for (id, status of Object.entries(result)):
          this.cache.set(id, status)
          this.pending.delete(id)
      return Object.fromEntries(ids.map(id => [id, this.cache.get(id) ?? "unknown"]))
  }

  // Constructed per request via ctx-builder middleware.
```

```
home/enrich.ts:
  enrich(items, ctx, opts):
    statuses    = await ctx.statusBatch.get(items.map(i => i.tmdbId))
    metadata    = await catalog.getMetadataBatch(items.map(i => ({ tmdbId: i.tmdbId, type: i.mediaType })))
    requestProviders = capabilityRegistry.listProviders("requests", "v1", "user")
                                                                  // capabilityRegistry, NOT mediaService.listProviders
                                                                  // (registry is the canonical lookup; cached singleton)

    return Promise.all(items.map(async i => ({
      ...i,
      status: statuses[i.tmdbId],
      availability: await deriveAvailability(i, statuses[i.tmdbId], requestProviders, ctx),
      facets: deriveFacets(metadata[i.tmdbId], i),
      matchReason: pickMatchReason(opts.rowId, i, ctx),
    })))

  deriveAvailability(item, status, requestProviders, ctx):
    hasAnyServerCopy = status === "available"
    requestEligible  = status !== "available" && requestProviders.length > 0
    servers = hasAnyServerCopy
              ? await ctx.mediaService.getMatchingServers(item.tmdbId)   // [{id,label}]; cached per-request
              : []
    return { hasAnyServerCopy, requestEligible, servers }

  deriveFacets(meta, item):
    return {
      runtimeMin:    meta?.runtime_minutes,
      episodeCount:  item.mediaType === "tv" ? meta?.features?.episodeCount : undefined,
      releaseDate:   meta?.year ? String(meta.year) : undefined,                 // v1 = year only
    }
```

## Catalog change

`recommendation_lists.items` JSON shape gains `top_contributors`:

```
// `RecItem` shape (apps/server/src/catalog/types.ts:63) — camelCase in code:
items: [
  { tmdbId, mediaType, matchReason: string, topContributors: TopContributor[], score }
]

TopContributor = {
  category: "genre"|"person"|"keyword"|"decade"|"language"|"runtime",
  value: string,                              -- "Drama" | "Lena Marsh" | "thriller" | "2020s" | "en" | "long"
  weight: number,                             -- already ranked; first = strongest
}
```

`apps/server/src/catalog/jobs/recommendation-build.ts:125` already calls `engine.explainRanked` per item; amend to also persist `entry.topContributors.slice(0, 3)` as snapshot. Drizzle migration: replace `recommendation_lists.items` JSON shape (no compat — pre-stable per memory).

## New job

```
host.home.layout_warm     (scheduled_per_row, every 60 min; runTimeoutSec = 30 * 60; perRowTimeoutSec = 60)
  rows = users w/ activity in last 14d
  per user:
    ctx  = buildContext(userId, { deadlineMs: now + 45_000 })   // 15s SQLite slack under 60s row cap
    blob = composeLayout(ctx, { forceFresh: true, skipWriteback: true })
    layoutCache.write(userId, blob)                              // sync, awaited
```

Reuses existing `scheduled_per_row` job kind. Per-user mutex. Idempotent. Failure isolated per row. Per rev 6, compose runs under a 45 s deadline that flows through every plugin call and enrichment leaf; the 60 s per-row cap is now a backstop, not the primary budget.

## getDetails composition

Already covered in §Orchestrator. Cache strategy = lean on existing `media/dispatch-cache.ts` for `metadata@v1.getDetails`. Per-capability TTLs:

- `metadata@v1` defaultCacheTtlSec stays as configured (verify ≥ 1 h; tighten if metric-driven).
- `continueWatching@v1` TTL — tighten to 2 min from 5 min in `packages/plugin-sdk/src/capabilities/continue-watching.ts` for fresher hero/active row.

## Error handling

```
home/errors.ts:
  classifyError(err):
    if err instanceof AllPluginsFailedError: return "all_plugins_failed"
    if err instanceof TimeoutError:          return "deadline_exceeded"
    if err instanceof PluginNotConfigured:   return "no_provider"
    return "internal_error"

  // Surfaced via existing errors/middleware.ts → HttpError envelope.
```

Per-row failure = `partial: true`, items array possibly empty, ⊥ throw.
Per-call hard failure = HttpError 500/504/502 routed through existing `errorHandler`.
Layout cache write failure = log + ignore (cold path next request).

**Deadline exceeded mid-compose (rev 6).** `invokeWithTimeout` clips per-plugin `timeoutMs` to `min(capability.defaultTimeoutMs, deadlineMs − now)`. When remaining < ~50 ms, the call short-circuits by throwing an `AbortError` (`name === "AbortError"`, message `deadline_exceeded (remaining <ms>ms)`) instead of arming a near-zero timer; the dispatcher's existing `AbortError` absorption path (`invokeOne` → `normalizeError` → `plugin.timeout`) normalises it to the standard `{ pluginId, connectionId, shared, error: { code: "plugin.timeout", devMessage } }` outcome shape accepted by `dispatchSingle` and `aggregate-per-kind.collectSuccessful`. In-flight legs reject the same `AbortError`.

Soft-failure absorption by granularity:
- **Per-row preview** — `previewRow` catch keeps the row stub (`include: true`, `partial: true` on its content fetch).
- **Per hero pool** — `loadPool` for one source rejects → caught locally inside `pickHero`, that pool collapses to `[]`, mixer + backfill still draw from remaining pools. Replace the current `resolveHero` blanket `.catch(() => null)` with per-pool catches so a single slow source cannot null the entire hero (consistent with rev 4 degenerate-fill intent: hero ships < 6 slides instead of disappearing).
- **enrichItems leaves** — `statusBatch` / `artwork` / `getMatchingServers` aborts caught in-place, item ships with default `status: "unknown"` / empty `servers` / unhydrated artwork (catalog fallback already covers `posterUrl`/`backdropUrl`).

Writeback proceeds with the partial blob — no diagnostics `error` row, `partial: true` on affected rows + degenerate hero shape suffice.

## Tests

```
apps/server/src/home/__tests__/
  orchestrator.test.ts
    - composeLayout returns cached blob when fresh
    - composeLayout falls through on stale + writes back
    - composeRow throws 404 on unknown rowId
    - composeDetails returns details=null + error on plugin reject
    - composeDetails cold-fills catalog metadata on miss
  hero.test.ts
    - mix returns 6 slides w/ correct quota when all sources full (1 CW + 2 rec + 2 trend + 1 new)
    - empty CW: 5 drawn + 1 backfilled from recs (priority cascade order)
    - only CW populated: returns ≤4 slides all source=continueWatching (degenerate fill)
    - only newReleases populated: returns up to 6 slides all source=newReleases
    - returns null when all sources empty
    - slides[i].source / reason match origin pool (CW slide → continue_watching, etc.)
    - lead = highest-priority non-empty source (CW first, else rec, else trend, else new)
    - body order = round-robin interleave by priority over remainder
    - backfill never duplicates a `${source}:${tmdbId}` key
    - cross-source dupes collapse: same tmdbId in trendingNow + newReleases pools → only trending slide kept (rev 5)
    - priority winner: same tmdbId in all four pools → only continueWatching slide kept (rev 5)
    - resumeUrl is null on every slide v1 (incl. CW slides — see R2)
  match-reason.test.ts
    - finishing_soon when progress >= 0.85
    - similar_to_seed includes seedTitle param
    - mapTopContributor: genre → from_genre_you_love
    - returns null for trending/newReleases rows
  cursor.test.ts
    - encode/decode round-trips structure
    - rejects malformed base64
    - rejects malformed JSON post-decode
    - rejects fields outside zod schema
  layout-cache.test.ts
    - read returns null on cold cache
    - write upserts
    - isFresh boundary at 60 min
  layout-warm.deadline.test.ts                          (rev 6)
    - warm-job handler sets ctx.deadlineMs ≈ now + 45_000 (±10ms via fake clock)
    - fake continueWatching@v1.getContinueWatching sleeps 90s, all other
      providers respond < 1s → layoutCache.write called with partial blob
      (hero present from non-CW pools, CW row dropped or partial:true);
      no per-row timeout thrown; no cron.job_failed capture
  enrich.deadline.test.ts                                (rev 6)
    - enrichItems forwards deadlineMs to StatusBatchMemo.get,
      ArtworkService.getArtwork, MediaService.getMatchingServers
    - per-item availability abort caught locally; item ships with empty
      servers + status:"unknown"

apps/server/src/home/rows/__tests__/
  continue-watching-active.test.ts
    - filters entries w/ progressMs > 0 + progress < 0.85
    - cursor pagination at offset 0/12/24
    - partial flag propagated from aggregate
    - empty when no continueWatching capability
  continue-watching-next.test.ts
    - filters nextUp entries
    - seriesContext.nextUpFromServer = true on stitched
  because-you-watched.test.ts
    - eligibility false when history empty
    - initialCursor encodes seed
    - paginates similar feed
  recommended-for-you-tv.test.ts
    - filters mediaType=tv
    - drops status=available items
    - top_contributors carried through
  recommended-for-you-movies.test.ts
    - mirror tv tests w/ media_type=movie
  your-watchlist.test.ts
    - filters status=available only
  upcoming-for-you.test.ts
    - bounded single page
    - partial on calendar plugin err
  trending-now.test.ts
    - reads day snapshot
    - paginates by offset
  new-releases.test.ts
    - mirror trending tests w/ release_date_asc

apps/server/src/api/procedures/__tests__/home.test.ts
  - GET /api/home/layout returns 401 unauthenticated
  - GET /api/home/layout returns layout w/ rows + hero
  - GET /api/home/row?rowId=X&cursor=null returns first page
  - GET /api/home/row?rowId=invalid returns 404
  - GET /api/home/details?tmdbId=X&type=movie returns summary + details

packages/shared/src/home/__tests__/
  schemas.test.ts
    - getLayout/getRowContent/getDetails input zod round-trips

apps/server/src/media/__tests__/
  invoke.deadline-clip.test.ts                           (rev 6)
    - timeoutMs clipped to remaining when remaining < defaultTimeoutMs
    - timeoutMs unchanged when remaining > defaultTimeoutMs
    - remaining ≤ 50ms → synthetic plugin.timeout outcome, no timer armed
    - retry path: backoff still gated by deadlineAllowsRetry (existing)
```

Test infra: existing `vp test`. Each row test uses `MediaService` test double + in-memory CatalogService fixture (existing pattern in `apps/server/src/__tests__/`).

Per-row test required by convention; spec failure to write one = CI fail via fallow zone scan (boundary rule: `home/rows/<file>.ts` must have matching `home/rows/__tests__/<file>.test.ts`; enforce via lint rule or CI script).

## Files

```
NEW
  apps/server/src/home/procedures.ts
  apps/server/src/home/orchestrator.ts
  apps/server/src/home/hero.ts
  apps/server/src/home/match-reason.ts
  apps/server/src/home/cursor.ts
  apps/server/src/home/status-batch.ts
  apps/server/src/home/layout-cache.ts
  apps/server/src/home/enrich.ts
  apps/server/src/home/errors.ts
  apps/server/src/home/types.ts
  apps/server/src/home/rows/index.ts
  apps/server/src/home/rows/continue-watching-active.ts
  apps/server/src/home/rows/continue-watching-next.ts
  apps/server/src/home/rows/because-you-watched.ts
  apps/server/src/home/rows/recommended-for-you-tv.ts
  apps/server/src/home/rows/recommended-for-you-movies.ts
  apps/server/src/home/rows/your-watchlist.ts
  apps/server/src/home/rows/upcoming-for-you.ts
  apps/server/src/home/rows/trending-now.ts
  apps/server/src/home/rows/new-releases.ts
  apps/server/src/home/jobs/layout-warm.ts
  apps/server/src/home/__tests__/orchestrator.test.ts
  apps/server/src/home/__tests__/hero.test.ts
  apps/server/src/home/__tests__/match-reason.test.ts
  apps/server/src/home/__tests__/cursor.test.ts
  apps/server/src/home/__tests__/layout-cache.test.ts
  apps/server/src/home/rows/__tests__/<row>.test.ts × 9
  apps/server/src/db/schema/home.ts
  apps/server/src/api/procedures/home.ts
  apps/server/src/api/procedures/__tests__/home.test.ts
  packages/shared/src/home/__tests__/schemas.test.ts

CHANGED
  packages/shared/src/home/enums.ts        +MATCH_REASON_KEYS
  packages/shared/src/home/types.ts        +MatchReason, +Availability, +Facets, +SeriesContext, +MediaDetailsExtra/Response, CompactMediaItem reshape, HomeRowStub +kind/+rowId-as-string, LayoutHero +alternates
  packages/shared/src/home/schemas.ts      +homeGetDetailsInputSchema, rowId.string()
  apps/server/src/db/schema/catalog.ts     recommendation_lists.items JSON +top_contributors
  apps/server/src/catalog/jobs/recommendation-build.ts:125  persist topContributors[0..2]
  apps/server/src/catalog/types.ts         +TopContributor, RecItem +topContributors field
  apps/server/src/media/service.ts         +getContinueWatchingFeed, +getMatchingServers
  apps/server/src/api/router.ts            +.route("/home", homeApp)
  apps/server/src/jobs/registry.ts         +host.home.layout_warm
  packages/shared/src/home/types.ts        HomeRowStub.title → titleKey, subtitle → subtitleKey (i18n key strings)
  apps/client/src/features/home/hooks/use-home-feed.ts       hits /api/home/* via TanStack Query (mock removed)
  apps/client/src/features/home/lib/types.ts                 drop facets.monochrome, drop seasons[]
  apps/client/src/features/home/components/home-feed.tsx     read item.matchReason as MatchReason object
  apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx   resume/play handler — nav-to-detail (no resumeUrl v1)
  apps/client/src/features/home/__tests__/card.test.tsx      update expectations for typed matchReason
  apps/client/src/shared/components/media-detail-modal/types.ts             MatchReason imports from shared/home
  apps/client/src/features/home/lib/mock-data.ts             DELETE
  apps/client/src/features/home/lib/mock-pagination.ts       DELETE
  apps/client/src/features/home/hooks/use-mock-pagination.ts DELETE
  .changeset/<slug>.md                                       6 PRs (one per phase)
```

Rev 4 delta (Amendment 3 — see below). NEW + CHANGED:

```
NEW
  apps/server/src/home/__tests__/hero-mix.test.ts            (mix/quota/backfill/order; replaces hero.test.ts cascade cases)

CHANGED
  packages/shared/src/home/types.ts                          +HeroSlide; LayoutHero { slides: HeroSlide[] } (drop item/source/reason/resumeUrl/alternates)
  apps/server/src/home/hero.ts                               replace cascade w/ mixer (loadPool / drawByQuota / backfill / orderCascadeLeadInterleave)
  apps/server/src/home/layout-cache.ts                       CURRENT_SCHEMA_VERSION = 2
  apps/server/src/home/__tests__/hero.test.ts                rewrite per §Tests (or rename to hero-mix.test.ts)
  apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx   iterate slides[]; drop alternates path
  apps/client/src/features/home/components/top-zone/index.tsx                pass slides through to hero card; per-slide source label
  apps/client/src/features/home/__tests__/top-zone.test.tsx                  expectations for slides[] iteration + per-slide source label
```

## Risks + assumptions

- **R1.** `MediaService` ⊥ `getContinueWatchingFeed`/`getMatchingServers` today. PROMOTED to hard prerequisite — PR 3 first commit adds both:
  - `getContinueWatchingFeed(opts)` — wraps `dispatchAggregate({ capability: "continueWatching", version: "v1", method: "getContinueWatching" })` + `interpretAggregate`. Mirrors `getWatchlistFeed` pattern.
  - `getMatchingServers(tmdbId)` — walks `resolveConnections` for plugins implementing `library@v1`, returns `{ id, label }[]` for connections that have a copy. Cached per-request.
- **R2.** ~~`playback@v1.getResumeUrl`~~ MOVED to non-goals. Hero `resumeUrl` always `null` v1; UI Play button = nav-to-detail.
- **R3.** `rec.items[].topContributors` field added; existing rec-list rows pre-migration ⊥ have field. Job rerun on first deploy fills. Orchestrator handles missing as "fallback to highly_rated".
- **R4.** Layout cache JSON blob can grow if rows × items expanded. Cap = ~2KB at v1 sizes (9 rows × ~200B stub = 1.8KB). Acceptable.
- **R5.** `host.home.layout_warm` runs hourly across all active users — for 1000-user install w/ 60s budget per row × 9 rows = up to 9 min worst-case per user. `runTimeoutSec=30*60` accommodates. Stagger via existing job-service jitter.
- **R6.** `home_layout_cache` blob shape evolves w/ wire format. Add `schema_version integer NOT NULL` column; `layoutCache.read` discards blobs w/ mismatched version → live recompose. Bump on any `HomeLayoutResponse`/`HomeRowStub`/`LayoutHero` shape change.
- **R7.** `continueWatching@v1` cache TTL stays at SDK default (`5 * MIN`). ⊥ change capability default — affects all consumers including future MCP tools. Per-call freshness via dispatcher `skipCache: true` on hero cascade only when staleness signal detected (deferred — v1 accepts 5-min staleness in hero).
- **A1.** Active-user signal = activity last 14d. Reuse existing `last_activity_at` if present; else default to all users (small installs).
- **A2.** Pre-stable project — DB shape changes for `recommendation_lists` and wire shape changes for `CompactMediaItem` ⊥ require compat shims (per project memory).
- **A3.** Client uses TanStack Query for `/api/home/*` calls; mock infra removed in same PR as procedure wiring.
- **A4.** `rec.items[]` use camelCase (`tmdbId`, `mediaType`, `matchReason`, `topContributors`, `score`) per existing `RecItem` interface (`apps/server/src/catalog/types.ts:63`). All pseudo-code in §Per-row pipelines uses camelCase; snake_case in §Catalog change refers to JSON column names only, not field shape.
- **A5.** `CatalogService.getRecommendations(userId, "default")` valid — `RECOMMENDATION_LIST_KINDS = ["default"]` confirmed at `apps/server/src/catalog/types.ts:9`.
- **A6.** Hero null fallback — UI design covered in `2026-05-04-home-page-implementation-design.md`. Server emits `hero: null`, `HomeFeed` skips `<TopZone>` render.
- **R12.** (rev 4) Degenerate fill — when only one source has supply (e.g. brand-new install w/ only TMDB trending populated), backfill exhausts that single pool and the hero ships fewer than 6 slides, all same source. Acceptable: still distinct from any single row (pool size = 6 vs row first page ≤ 12), and rare in practice once recs job has run once. Tests cover the all-same-source branch.
- **R13.** (rev 4) Schema bump 1 → 2 invalidates every existing `home_layout_cache` row on first deploy. First request per active user falls through to live composition + write-back. Cost = N active users × one cold compose (≤ 5 s budget); spread by `host.home.layout_warm` jitter on next hourly tick.
- **A9.** (rev 4) Mixer bypasses the previous `pickContinueWatchingHero` / `pickRecommendedHero` / `pickTrendingHero` / `pickNewReleaseHero` exports. They are removed in PR 7; nothing else imports them (only `pickHero` is exported via `home/hero.ts`). Verify before delete via grep.
- **R14.** (rev 6) Warm-job per-row 60 s cap split into 45 s compose + 15 s writeback. Assumes SQLite `home_layout_cache` upsert p99 < 15 s (single PK, ~2 KB blob; sub-ms in practice). Concurrent retention job, large cache table, or WAL checkpoint pressure could erode the margin — both numbers re-tune together if violated. Diagnostics surface `cron.job_failed` with message `per-row timeout` on breach; that capture is the canary for retuning.
- **A10.** (rev 6) `invokeWithTimeout` clip applies to ALL deadline-bearing callers, not just warm. Request path (`ctx.deadlineMs = now + 8_000`) gets the same semantics for free — a single slow plugin can no longer consume the whole 8 s. Tested via `media/__tests__/invoke.deadline-clip.test.ts`.

## Implementation phases (PR breakdown)

**Stacked PRs — must merge in order.** Each PR ships green CI alone (types/tests pass, app builds), but landing PR N+1 before PR N breaks the build. The wire reshape in PR 1 forces the client update in PR 6 — the gap between them keeps `MatchReason | string` as a transitional union (PR 1 ships union; PR 6 narrows to `MatchReason`).

| PR  | Slug                           | Scope                                                                                                                                                                                                                               | Depends on                                 |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `home-shared-wire`             | reshape `@ent-mcp/shared/home` types + enums + schemas; `MatchReason` as `string \| MatchReasonObj` transitional union; `HomeRowStub.title→titleKey/subtitle→subtitleKey` rename                                                    | —                                          |
| 2   | `home-catalog-contributors`    | catalog rec list `topContributors` field; `recommendation-build` job amend; Drizzle migration; `RecItem` interface +field                                                                                                           | PR 1 (TopContributor type lives in shared) |
| 3   | `home-mediaservice-extensions` | add `MediaService.getContinueWatchingFeed`, `MediaService.getMatchingServers` w/ tests                                                                                                                                              | — (independent of PRs 1-2)                 |
| 4   | `home-row-providers`           | RowProvider iface, cursor codec, status-batch memo, all 9 row pipelines + per-row tests; ⊥ wired to API yet                                                                                                                         | PRs 1, 2, 3                                |
| 5   | `home-orchestrator`            | hero cascade (resumeUrl=null), orchestrator, `home_layout_cache` table + migration (incl. `schema_version`), `host.home.layout_warm` job, register `/home` procedures, `getDetails` endpoint                                        | PR 4                                       |
| 6   | `home-client-integration`      | replace `useHomeFeed` mock w/ TanStack Query; narrow `MatchReason` union to object-only in shared; update `home-feed.tsx`/`top-zone-hero-card.tsx`/`card.test.tsx`/modal types; delete mock files; drop `facets.monochrome`/seasons | PR 5                                       |
| 7   | `home-hero-mix`                | rev 4 — reshape `LayoutHero` → `{ slides: HeroSlide[] }`; mixed-source composer (loadPool/drawByQuota/backfill/order); bump `home_layout_cache.schema_version` 1→2; client iterates slides[] w/ per-slide source label              | (independent of seasons amendment)         |
| 8   | `home-deadline-propagation`    | rev 6 — signature reshapes: `buildContext(userId, logger?, opts?: { deadlineMs? })`, `StatusBatchMemo.get(ids, { deadlineMs? })`, `ArtworkService.getArtwork(requests, { deadlineMs? })` (forwards into its `dispatchAggregatePerKind` request), `MediaService.getMatchingServers(tmdbId, mediaType, { deadlineMs? })`, `MediaService.getShowSeasons(tmdbId, { deadlineMs? })`, `MediaService.getMetadata(tmdbId, mediaType, { deadlineMs? })`. `invokeWithTimeout` clip to `min(defaultTimeoutMs, remaining)` + synthetic `plugin.timeout` outcome at ≤50 ms. Warm-job handler sets `now + 45_000`. Replace `resolveHero` blanket `.catch(() => null)` with per-pool catches. Regression test in `apps/server/src/home/__tests__/layout-warm.deadline.test.ts`: warm job, fake `continueWatching@v1.getContinueWatching` provider sleeps 90 s, other providers respond < 1 s → `layoutCache.write` invoked with partial blob (hero present, CW row dropped or `partial:true`), no per-row timeout error thrown, no `cron.job_failed` capture. Also add `media/__tests__/invoke.deadline-clip.test.ts` (deadline-clip arithmetic + synthetic short-circuit). | PR 7                                       |

Each PR ships a changeset (per project rule: 1-2 sentences, end-user voice).

## Amendment 2 — TV Season Availability (rev 2, 2026-05-06)

Promotes per-season availability from non-goal to in-scope. Two-call shape: canonical season+episode list piggybacks on `home.getDetails` (TV-only); per-server episode presence is a new RPC `home.getSeasonAvailability`. Splits freshness profiles: canonical = day-cached, presence = 5-min-cached. Frontend renders modal w/ details immediately, suspends only the seasons accordion until availability lands.

### Plugin SDK additions

- `metadata@v1.getShowSeasons({ id })` → `{ seasons: SeasonInfo[] }`. TMDB plugin ships impl. Day-cached at dispatch.
- `libraryAvailability@v1.listShowEpisodes({ id, idType })` → `{ episodes: Array<{ season, episode }> }`. Plex + Jellyfin plugins ship impls; both walk one HTTP call (`allLeaves` / `/Shows/{id}/Episodes`). Cross-server `idType` (`tmdb`) → plugin first uses own `idResolve@v1` to translate. Empty list when title absent (⊥ throw). 5-min cached.

See `docs/2026-04-19-plugin-architecture-design.md` for full method definitions.

### Server composition

```
home/orchestrator.ts:
  composeDetails(ctx, tmdbId, type):                         // existing, extended
    summary  = catalog.getMetadata + cold-fill                // unchanged
    details  = mediaService.getDetails (settled)              // unchanged
    if type === "tv":
      seasons = mediaService.getShowSeasons(tmdbId).catch(()=>undefined)  // rev 2 — best-effort
      details.seasons = seasons                                // appended when present
    return { summary, details: ..., error?: ... }

  composeSeasonAvailability(ctx, tmdbId):                    // rev 2 — new
    conns = resolveConnections("libraryAvailability", "v1", "user")
    if conns.length === 0: return { servers: [] }
    settled = await Promise.allSettled(conns.map(c =>
      dispatch({ capability: "libraryAvailability", method: "listShowEpisodes",
                 connectionId: c.id, input: { id: tmdbId, idType: "tmdb" } })))
    servers = []
    errors  = []
    for ([conn, s] of zip(conns, settled)):
      serverId    = `${conn.pluginId}:${conn.connectionId}`   // shared pool: pluginId only
      serverLabel = conn.plugin.displayName
      if s.status === "rejected":
        errors.push({ serverId, serverLabel, code: classifyError(s.reason) })
        continue
      // Plugins return flat episode list; host sorts (season, episode) ascending
      // and ships as-is. Client buckets to seasons map at render time.
      sorted = [...s.value.episodes].sort((a, b) =>
        a.season === b.season ? a.episode - b.episode : a.season - b.season)
      servers.push({ serverId, serverLabel, episodesPresent: sorted })
    return errors.length > 0 ? { servers, errors } : { servers }
```

`MediaService` extension (`apps/server/src/media/service.ts`):

- `getShowSeasons(tmdbId)` — wraps `dispatch({ capability: "metadata", method: "getShowSeasons", input: { id: tmdbId } })`. Lifts `seasons` array; null on plugin err (caller decides whether to omit field or 500).

### Catalog change (rev 2)

Optional. Canonical seasons can be cached at the catalog layer for sub-ms reads on repeat opens of same show:

- `catalog_show_seasons` table: PK `(tmdb_id)`; columns `seasons_json TEXT`, `fetched_at INTEGER`. TTL = 24h. Read-through: `composeDetails` checks catalog first, else calls metadata plugin + writes back. Defer to rev 3 if measured TTFB w/o catalog is acceptable.

v1 of amendment: skip catalog cache, lean on dispatch cache (DAY default for `metadata@v1`). Add catalog table only if we observe redundant TMDB calls in metrics.

### Error handling

- `composeDetails` season fetch failure: `details.seasons` omitted; modal renders details w/o seasons accordion. ⊥ surface error envelope.
- `composeSeasonAvailability` per-plugin failure: `errors[]` lists serverId + classified code; UI renders successful servers + warning row.
- `composeSeasonAvailability` fully empty (no `libraryAvailability@v1` providers configured): returns `{ servers: [] }`. Client treats as "no servers" → renders canonical season list w/o per-server chips.

### UI integration (delta against rev 1 client spec)

`modal-seasons.tsx` (currently a placeholder per `home-page-implementation-design.md`) becomes:

```
modal-seasons/
  index.tsx              — Suspense boundary + header + section frame
  seasons-list.tsx       — wraps existing RequestableSeasons (request-flow) w/ pluginConfigured=false
  use-season-availability.ts  — useSuspenseQuery → /api/home/season-availability
  derive-status.ts       — best-of-N reducer: avail / partial / unavailable / upcoming
  seasons-error.tsx      — ErrorBoundary fallback (full failure → "couldn't load servers" microcopy)
```

`RequestableSeasons` (already at `apps/client/src/features/request-flow/components/requestable-seasons.tsx`) is reused as-is w/ `pluginConfigured={false}` → renders `RequestStatusBadge` instead of `SeasonRequestAction`. Adapter joins canonical `SeasonInfo[]` × `SeasonAvailabilityServer[]` → `Season[]` shape that component expects.

Best-of-N status derivation per season (computed against the per-season slice
of each server's `episodesPresent` flat list):

- `available` — any server has `episodesPresent[season].length >= season.totalEpisodes`
- `partial` — any server has 0 < `episodesPresent[season].length` < total
- `unavailable` — all servers report 0 (or no servers)
- `upcoming` — `season.airDate > now()` AND no server has any episode

Note the deliberate split between season-level and episode-level rollups in
`derive-status.ts`: episode chips use the _union_ across servers ("can the
user watch this episode somewhere?"), season status uses _per-server_
("does any single library cover the whole season?"). Split-library edge
case (Server A holds S1E1–6, Server B holds S1E7–12) therefore shows green
chips on every episode while the season badge still reports `partial` —
that is correct because no single library has the season, so a request
would still fill a gap.

Specials filter: `seasonNumber === 0` rendered only when ≥1 server has ≥1 episode. Pure-canonical specials silenced.

### Files (delta)

```
NEW
  packages/plugin-sdk/src/capabilities/__tests__/library-availability.test.ts  (extend)
  packages/plugin-sdk/src/capabilities/__tests__/metadata.test.ts             (extend)
  packages/plugins/tmdb/src/capabilities/metadata.ts                          (extend — getShowSeasons)
  packages/plugins/tmdb/__tests__/get-show-seasons.test.ts
  packages/plugins/plex/src/capabilities/library-availability.ts              (extend — listShowEpisodes)
  packages/plugins/plex/__tests__/list-show-episodes.test.ts
  packages/plugins/jellyfin/src/capabilities/library-availability.ts          (extend — listShowEpisodes)
  packages/plugins/jellyfin/__tests__/list-show-episodes.test.ts
  apps/server/src/home/season-availability.ts                                 (composeSeasonAvailability)
  apps/server/src/home/__tests__/season-availability.test.ts
  apps/server/src/api/procedures/home.ts                                      (extend — getSeasonAvailability)
  apps/server/src/api/procedures/__tests__/home.test.ts                       (extend)
  apps/server/src/media/service.ts                                            (extend — getShowSeasons)
  apps/client/src/shared/components/media-detail-modal/modal-seasons/
    index.tsx
    seasons-list.tsx
    use-season-availability.ts
    derive-status.ts
    seasons-error.tsx
    __tests__/derive-status.test.ts
    __tests__/seasons-list.test.tsx
  packages/shared/src/home/__tests__/schemas.test.ts                          (extend)

CHANGED
  packages/shared/src/home/types.ts                +SeasonInfo, +SeasonEpisodeInfo, +SeasonAvailability*, MediaDetailsExtra +seasons?
  packages/shared/src/home/schemas.ts              +homeGetSeasonAvailabilityInputSchema
  packages/plugin-sdk/src/capabilities/metadata.ts +getShowSeasons method
  packages/plugin-sdk/src/capabilities/library-availability.ts +listShowEpisodes method
  apps/server/src/home/orchestrator.ts             composeDetails appends seasons for tv path
  apps/server/src/api/router.ts                    new /api/home/season-availability route
  apps/client/src/shared/components/media-detail-modal/index.tsx              swap modal-seasons.tsx → modal-seasons/index.tsx
  apps/client/src/shared/components/media-detail-modal/modal-seasons.tsx      DELETE (replaced by sub-dir)
```

### Implementation phases (rev 2 amendment)

Five stacked PRs. See `plan/feature-home-tv-seasons-1.md` for full breakdown.

| PR  | Slug                          | Scope                                                                                                | Depends on |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1   | `seasons-shared-wire`         | `@ent-mcp/shared/home` types + schemas additions                                                     | —          |
| 2   | `seasons-plugin-sdk`          | `metadata@v1.getShowSeasons` + `libraryAvailability@v1.listShowEpisodes` SDK methods + tests         | PR 1       |
| 3   | `seasons-plugin-impls`        | TMDB `getShowSeasons` impl; Plex + Jellyfin `listShowEpisodes` impls; per-plugin tests               | PR 2       |
| 4   | `seasons-server-orchestrator` | `MediaService.getShowSeasons`, `composeSeasonAvailability`, `composeDetails` extension, route, tests | PRs 1, 3   |
| 5   | `seasons-client-modal`        | `modal-seasons/` sub-dir, Suspense, ErrorBoundary, adapter to `RequestableSeasons`                   | PR 4       |

### Risks + assumptions (rev 2)

- **R8.** Plugin enumeration cost on huge libraries: `allLeaves` for a 10-season Plex show w/ 250 eps returns one HTTP body w/ all 250 entries. Wire size ~50KB. Acceptable. Jellyfin same shape.
- **R9.** TMDB seasons fetch uses `append_to_response=season/1,…,season/N`. Limit ~20 seasons per call before TMDB truncates URL. Mitigation: long-running shows (>20 seasons, e.g. soap operas) iterate in chunks; deferred until observed.
- **R10.** Season presence cache TTL = `libraryAvailability@v1.defaultCacheTtlSec` (5 min). User adding episode to Plex sees update within 5 min. Acceptable. Manual refresh button (skipCache) deferred.
- **R11.** `RequestableSeasons` component is request-flow-shaped — it accepts `pluginConfigured={false}` to render badges instead of action buttons. Reusing it sidesteps rebuilding accordion/episode list visuals; minor friction is the `Season` adapter type. Component split into pure-display variant deferred until request flow lands and shape stabilises.
- **A7.** Specials filter is purely client-side derivation. Server returns canonical season 0 unconditionally when TMDB lists it; client suppresses if no server has episodes.
- **A8.** Loading UX: `<Suspense>` boundary at `modal-seasons` only — modal body renders eagerly w/ details. Initial fetch via `useSuspenseQuery`. Plugin failures bubble to local `<ErrorBoundary>` showing "couldn't reach <server>" microcopy alongside any successful server data.

## Amendment 3 — Hero mixed-source slides (rev 4, 2026-05-07; rev 5, 2026-05-22)

Promotes the hero from a single-source cascade to a mixed-source slide list. Symptom: with the cascade, a user with any continue-watching activity gets a hero whose every slide draws from CW — visually a 1:1 echo of the "Pick up where you left off" row directly below it. Goal: hero stays distinct from any single row by default while still leading with the most-actionable item (resume something you started).

### Motivation

- Real installation observed two slides, both from CW, mirroring CW row.
- UI design intent (`2026-05-04-home-page-implementation-design.md`) treats hero as a curated showcase, not a row preview.
- Existing wire shape (`item + alternates[]`) ties every slide to one source/reason, blocking mixed labelling.

### Composition rule

- **Quota** — fixed per source for 6 total slides:
  - `continueWatching` × 1
  - `recommendedForYou` × 2
  - `trendingNow` × 2
  - `newReleases` × 1
- **Backfill** — when a source is short, cascade by priority `[CW, rec, trend, new]` and pull the next unused candidate from each non-empty pool until the target is reached. Stops when every pool is exhausted (degenerate fill ships < 6 slides; never throws).
- **Order** — `lead = first non-empty source by priority`; remainder = round-robin interleave by priority over what is left. Lead is therefore always CW when CW has any candidate, else rec, else trend, else new — matching the cascade-priority feel without limiting the body to one source.
- **Dedup** — none against other rows (per design call). Within hero, pools are deduped across sources by `${mediaType}:${tmdbId}` before `drawByQuota` (rev 5), with the higher-priority source `[CW, rec, trend, new]` keeping the slide. The same title cannot appear in two hero slides regardless of which pools it sits in. Backfill additionally skips already-used `${source}:${tmdbId}` keys when topping up short pools.

### Wire shape

`LayoutHero` reshapes:

```ts
// before (rev 3)
interface LayoutHero {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
  alternates: CompactMediaItem[];
}

// after (rev 4)
interface HeroSlide {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
}
interface LayoutHero {
  slides: HeroSlide[];
}
```

`null` LayoutHero only when every source is empty. Pre-stable per project memory — no compat union; client narrows in same PR.

### Cache invalidation

`home_layout_cache.schema_version` bumps `1 → 2`. Existing rows discarded on first read after deploy (per existing R6 contract). Live recompose populates v2 blob on the next request; `host.home.layout_warm` warms v2 blobs on the next hourly tick.

### Server composition

Composer pseudocode lives in §Hero composition (rewritten this revision). High-level flow:

1. Per source, `loadPool(source, ctx)` returns up to 6 stamped slides (`{ item, source, reason, resumeUrl }`).
2. `dedupePools` walks priority order and drops slides whose `${mediaType}:${tmdbId}` is already retained by a higher-priority source (rev 5). Backfill therefore can never re-introduce a cross-source duplicate.
3. `drawByQuota` walks priority order taking the per-source quota.
4. `backfill` cascades through priority pools to top up to 6, skipping `${source}:${tmdbId}` keys already drawn.
5. `orderCascadeLeadInterleave` selects the lead from the first non-empty priority pool, then round-robins remainder.
6. `enrichItems` runs once across all final slide items (status, availability, facets) — same surface as rows.
7. `resumeUrl` is currently always `null`; structure preserved so future SDK addition (`playback@v1.getResumeUrl`) can populate CW slides only.

### Client integration

- `top-zone-hero-card.tsx` iterates `slides[]`. Auto-rotate continues to use the first slide as initial; carousel cycles through all slides.
- Per-slide source label rendered from `slide.source` (e.g. "Continue Watching", "Trending Now"). Mapping lives in `top-zone/source-label.ts` (new file or inline tuple — implementation choice in PR 7).
- `slide.resumeUrl` always `null` v1 → Play button = nav-to-detail (unchanged behaviour from rev 1).
- `card.test.tsx` / `top-zone.test.tsx` updated to expect slides[] iteration + per-slide source label.

### Tests

See §Tests `hero.test.ts` block (rewritten this revision).

### Implementation phases (Amendment 3)

Single PR — `home-hero-mix` (PR 7 in §Implementation phases). Independent of seasons amendment (Amendment 2). Stacks on top of PR 6 (which lands the slides[]-naive client). Ships:

- shared types reshape (HeroSlide, LayoutHero.slides)
- server `home/hero.ts` rewrite + new tests
- `layout-cache.ts` `CURRENT_SCHEMA_VERSION = 2`
- client `top-zone-hero-card.tsx` slides[] iteration + per-slide label

### Risks (Amendment 3)

See R12, R13, A9 in §Risks + assumptions.

## Related specifications

- [Home page UI implementation](2026-05-04-home-page-implementation-design.md)
- [Catalog Service](../../2026-04-27-catalog-service-design.md)
- [Preference Engine](../../2026-04-20-preference-engine-design.md)
- [Job Service](../../2026-04-20-job-service-design.md)
- [Plugin Architecture](../../2026-04-19-plugin-architecture-design.md)
- [SPEC.md](../../../SPEC.md)

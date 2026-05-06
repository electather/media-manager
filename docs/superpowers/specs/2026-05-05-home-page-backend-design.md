# Home Page Backend

**Status:** Draft (rev 3)
**Date:** 2026-05-05 (rev 2: 2026-05-06, rev 3: 2026-05-06)
**Author:** Omid Astaraki
**Deps:** `2026-04-20-job-service-design.md`, `2026-04-20-preference-engine-design.md`, `2026-04-27-catalog-service-design.md`, `2026-05-04-home-page-implementation-design.md`
**Amends §V:** TBD on backprop

## Revision history

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

export interface LayoutHero {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
  alternates: CompactMediaItem[]; // NEW — 4 backdrop crossfade items from same source
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
export interface SeasonAvailabilityServer {
  id: string; // connection id
  label: string; // plugin displayName
  seasons: { seasonNumber: number; episodesPresent: number[] }[];
}

export interface SeasonAvailabilityError {
  serverId: string;
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
  };
  export const ROW_ORDER = Object.keys(ROW_PROVIDERS);    // static order
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
    res     = ctx.mediaService.getWatchlistFeed({ deadlineMs })
    statuses = ctx.statusBatch.get(res.items.map(i => `${i.type}:${i.tmdbId}`))
    avail    = res.items.filter(i => statuses[`${i.type}:${i.tmdbId}`] === "available")
    // mediaRequest@v1.getStatusBatch keys on composite "type:tmdbId" ids.
    items    = avail.slice(0, 12).map(toCompactMediaItem)
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

```
home/hero.ts:
  pickHero(ctx) → LayoutHero | null
    cascade = [
      { source: "continueWatching", reason: "continue_watching", get: pickContinueWatchingHero },
      { source: "recommendedForYou", reason: "recommended",      get: pickRecommendedHero },
      { source: "trendingNow",       reason: "trending",         get: pickTrendingHero },
      { source: "newReleases",       reason: "new_release",      get: pickNewReleaseHero },
    ]
    for each c in cascade:
      hit = c.get(ctx)                                   // returns { item, alternates[] } | null
      if hit:
        // Hero items share the row enrichment surface (status, availability,
        // facets) so the UI can render request-vs-play CTAs without a
        // follow-up fetch. Synthetic rowId "hero" falls through pickMatchReason.
        enriched = await enrichItems([hit.item, ...hit.alternates], ctx, { rowId: "hero" })
        [head, ...rest] = enriched
        return { item: head, source: c.source, reason: c.reason,
                 resumeUrl: resolveResumeUrl(head, ctx),
                 alternates: rest }
    return null

  pickContinueWatchingHero(ctx):
    res = ctx.mediaService.getContinueWatchingFeed({ deadlineMs })
    eligible = res.items.filter(e => e.progressMs > 0 && progress(e) < 0.85)
    sorted = orderBy(eligible, [e=>e.lastPlayedAt], ["desc"])
    if sorted.length === 0: return null
    head = sorted[0]
    alts = sorted.slice(1, 5).map(toCompactMediaItem)
    return { item: toCompactMediaItem(head), alternates: alts }

  pickRecommendedHero(ctx):
    rec = catalog.getRecommendations(userId, "default")
    if !rec: return null
    keys = rec.items.slice(0, 5)
    md   = catalog.getMetadataBatch(keys)
    head = toCompactMediaItem(md[keys[0].tmdb_id], { topContributors: keys[0].top_contributors })
    alts = keys.slice(1).map(k => toCompactMediaItem(md[k.tmdb_id]))
    return { item: head, alternates: alts }

  pickTrendingHero(ctx):
    snap = catalog.getDiscoverFeed("trending", "popularity_desc", today())
    if !snap || snap.length === 0: return null
    keys = snap.slice(0, 5); md = catalog.getMetadataBatch(keys)
    return { item: toCompactMediaItem(md[keys[0].tmdb_id]), alternates: keys.slice(1).map(...) }

  pickNewReleaseHero(ctx):
    // mirror, feed_kind="newReleases"

  resolveResumeUrl(item, ctx):
    return null    // v1 — playback@v1 has no getResumeUrl method (only getPositions/removePosition).
                   // Hero Play button = nav-to-detail v1. See §Non-goals + R2.
```

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

  CURRENT_SCHEMA_VERSION = 1   // const in home/layout-cache.ts
```

```
home/layout-cache.ts:
  STALE_MS = 60 * 60 * 1000
  CURRENT_SCHEMA_VERSION = 1

  read(userId) → { blob, generatedAt } | null
    row = db.select().from(homeLayoutCache).where(eq(user_id, userId)).get()
    if !row: return null
    if row.schema_version !== CURRENT_SCHEMA_VERSION: return null   // discard stale-shape blob
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
    // with an empty item list rather than crashing the request. HttpError and
    // any other unexpected throw still propagate to `errorHandler`.
    try:
      page = await provider.fetchPage(ctx, cursor)
    catch err:
      if err instanceof HttpError: throw err
      if isRowSoftFailure(err):                         // AllPluginsFailedError, PluginCallError, AbortError
        page = { items: [], cursor: null, partial: true }
      else: throw err
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
host.home.layout_warm     (scheduled_per_row, every 60 min; runTimeoutSec = 30 * 60)
  rows = users w/ activity in last 14d
  per user:
    blob = composeLayout(buildCtx(userId))   // bypasses cache check via internal flag
    layoutCache.write(userId, blob)
```

Reuses existing `scheduled_per_row` job kind. Per-user mutex. Idempotent. Failure isolated per row.

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
    - cascade returns continueWatching when eligible
    - cascade falls to recommended when CW empty
    - returns null when all sources empty
    - alternates exclude head item
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
      if s.status === "rejected":
        errors.push({ serverId: conn.id, code: classifyError(s.reason) })
        continue
      bySeason = groupBy(s.value.episodes, e => e.season)
      servers.push({
        id:    conn.id,
        label: conn.plugin.displayName,
        seasons: Object.entries(bySeason).map(([num, eps]) => ({
          seasonNumber:    Number(num),
          episodesPresent: eps.map(e => e.episode).sort((a,b) => a-b),
        })),
      })
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

Best-of-N status derivation per season:

- `available` — any server has `episodesPresent.length === season.totalEpisodes`
- `partial` — any server has 0 < `episodesPresent.length` < total
- `unavailable` — all servers report 0 (or no servers)
- `upcoming` — `season.airDate > now()` AND no server has any episode

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

## Related specifications

- [Home page UI implementation](2026-05-04-home-page-implementation-design.md)
- [Catalog Service](../../2026-04-27-catalog-service-design.md)
- [Preference Engine](../../2026-04-20-preference-engine-design.md)
- [Job Service](../../2026-04-20-job-service-design.md)
- [Plugin Architecture](../../2026-04-19-plugin-architecture-design.md)
- [SPEC.md](../../../SPEC.md)

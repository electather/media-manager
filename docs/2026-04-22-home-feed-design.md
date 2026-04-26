# Home Feed

**Status:** Draft
**Date:** 2026-04-22
**Author:** Omid Astaraki
**Deps:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-20-preference-engine-design.md`, `2026-04-19-frontend-connections-design.md`, `2026-04-19-error-management-design.md`, `mcp-server.md`

## Summary

Server-side surface behind dashboard's Netflix-style home page. Stack of themed rows (Continue Watching, Recommended For You, Trending Now, etc.) composed from plugin capabilities, re-ranked against user preference profile. Two oRPC procedures (`home.getLayout` & `home.getRowContent`), `HomeFeedService` orchestrating existing `MediaService` & `PreferenceEngine` into uniform row catalog. Caching/pagination/degradation behaviors included.

Scope: server-side only — endpoints, backing logic, data shapes, behavioral rules. Frontend = separate spec.

Follows MCP spec discipline: thin translation layer over `MediaService`, no new dispatch/runtime/credential/cache infra below it. Seven rows ship v1. Layout decisions = pure functions of cheap signal snapshot — swappable for A/B without touching fetch code.

## Goals

- Two oRPC procedures (`home.getLayout` & `home.getRowContent`) for dashboard.
- Reuse `MediaService`, `PreferenceEngine`, existing capability methods. No new capability/plugin contract/DB table.
- Degrade gracefully ∀ user states: no plugins, TMDB-only, tracker-connected, full install.
- Layout decisions ! pure functions — testable, cheap to A/B, safe to swap.
- Match MCP spec token-efficiency & error-handling: compact response shapes, `UserFacingError`.

## Non-goals

- Frontend design (card shape, scroll, skeleton, empty-state copy, rendering) — later frontend spec.
- Billboard hero unit — deferred; `layout.hero` additive field when shipped.
- Genre-scoped rows — deferred until `preference_profiles` data dense enough.
- Personalized row ordering from engagement tracking — ruled out per PreferenceEngine spec's "no things-we-showed-this-user tracking."
- Cross-row dedup — v1 accepts title may appear in both Trending & New Releases.
- Streaming/SSE — all procedures synchronous request/response v1.
- MCP surface — agents already get home-equivalent via `ent_discover mode=recommend|trending`.
- Dashboard rate limiting — inherits general oRPC layer.

## Architecture

```
             ┌─────────────────────────────┐
             │ oRPC procedures             │
             │   home.getLayout            │
             │   home.getRowContent        │
             └──────────────┬──────────────┘
                            │
                            ▼
             ┌─────────────────────────────┐
             │ HomeFeedService             │
             │  • resolveLayout            │
             │  • fetchRowContent          │
             │  • request-scoped dataloader│
             └───┬──────────────────┬──────┘
                 │                  │
                 ▼                  ▼
  ┌─────────────────────┐   ┌────────────────────────┐
  │ RowFetcher registry │   │ LayoutSignals          │
  │  continueWatching   │   │  inProgressCount       │
  │  recommendedForYou  │   │  profileConfidence     │
  │  trendingNow        │   │  hasWatchHistoryPlugin │
  │  newReleases        │   │  watchlistCount        │
  │  becauseYouWatched  │   │  recentSeed            │
  │  upcomingForYou     │   │  calendarProgressCount │
  │  yourWatchlist      │   │                        │
  └──────────┬──────────┘   └────────────┬───────────┘
             │                           │
             ▼                           ▼
       ┌──────────────────────────────────────┐
       │ MediaService   +   PreferenceEngine  │
       └──────────────────────────────────────┘
```

`HomeFeedService` = small orchestrator. Reads cheap signals, decides row layout via pure-function rule table, dispatches per-row content fetches parallel, assembles response. Each row = one `RowFetcher` entry — same file-per-fetcher pattern as PreferenceEngine's `FeatureScorer` registry.

### `RowFetcher` interface

```ts
type PluginRequirement = `${string}@v${number}`; // e.g. "watchHistory@v1"

interface RowFetchContext {
  userId: string;
  mediaService: MediaService;
  preferenceEngine: PreferenceEngine;
  dataloader: RequestScopedLoader;
  logger: Logger;
}

interface RowFetcher {
  rowId: RowKind;
  title: string;
  requires: PluginRequirement[]; // e.g. ["watchHistory@v1"]; empty = no deps
  fetch(
    ctx: RowFetchContext,
    opts: { cursor: string | null; limit: number },
  ): Promise<{ items: CompactMediaItem[]; cursor: string | null; partial?: true }>;
  isEligible(userId: string, loader: RequestScopedLoader): Promise<boolean>;
}
```

`RowFetchContext` = sole surface row fetcher sees. Nothing below `MediaService` accessible — plugin runtime, credentials, DB out of reach.

`isEligible` called only from `getRowContent` (not `getLayout`, which uses signal snapshot), ! cheap — per-row checks in §8 resolve off already-cached data, target sub-5ms. Required interface member (not optional): ∀ new rows must state eligibility rule explicitly; TypeScript refuses fetcher missing implementation. Row always eligible (see `newReleases` §8) returns `true` unconditionally.

`requires` field declarative — for future auto-doc & generic registry use. Authoritative runtime gate = `candidateRows` in `rules.ts` (§5). New row added → both must sync: `requires` lists capability deps for humans/tooling, `candidateRows` has live check that actually filters. When they disagree, `candidateRows` wins runtime.

Layout handler reuses `RowFetcher.fetch` for both inlined first page (inside `getLayout`) & scroll pagination (inside `getRowContent`). One fetch implementation per row, called with null cursor (most rows) or synthetic initial cursor for first page — plus real client-supplied cursor for scroll.

For rows needing out-of-band state on first page — currently only `becauseYouWatched` (seed lives in `LayoutSignals`, must be pinned for scroll session) — layout handler constructs initial cursor carrying that state before calling `fetch`. Concretely: `becauseYouWatched` receives `{ v: 1, r: "becauseYouWatched", p: 1, s: signals.recentSeed.id }` as `opts.cursor` rather than `null`. Fetcher always reads seed from cursor: ⊥ consults `signals.recentSeed` directly, ⊥ branches on "cursor null → page 1 → look up seed elsewhere." `RowFetchContext` deliberately ⊥ exposes signal snapshot; seed state threaded through cursor.

### Layout

```
server/
├── home/
│   ├── index.ts                      # HomeFeedService class (public surface)
│   ├── layout.ts                     # resolveLayout — rule table + orchestration
│   ├── signals.ts                    # LayoutSignals — cheap pre-fetch reads
│   ├── rules.ts                      # candidateRows + orderRows pure functions
│   ├── dataloader.ts                 # per-request MediaService cache
│   ├── compact.ts                    # CompactMediaItem shape + mapper
│   ├── cursor.ts                     # opaque cursor encode/decode
│   └── rows/
│       ├── index.ts                  # RowFetcher interface + registry
│       ├── continue-watching.ts
│       ├── recommended-for-you.ts
│       ├── trending-now.ts
│       ├── new-releases.ts
│       ├── because-you-watched.ts
│       ├── upcoming-for-you.ts
│       └── your-watchlist.ts
└── api/
    └── routes/
        └── home.ts                   # oRPC procedures: getLayout, getRowContent
```

No new capability files. No new DB migrations. Only `MediaService` additions: thin count methods & one batched status method (§8).

## API surface

Two oRPC procedures under `server/api/routes/home.ts`, authenticated-user-only (scope: `ctx.user.id`). No admin variants. Errors use `UserFacingError` from error-management doc.

**Shared types in `@ent-mcp/shared/home`.** Per repo shared-package rules (`CLAUDE.md`): types crossing server/client boundary live in `packages/shared/src/home/`, exported via subpath in `packages/shared/package.json`. Types that qualify: `RowKind` (const tuple + derived type), `HomeRow`, `HomeLayoutResponse`, `RowContentResponse`, `CompactMediaItem`. `FetchedRow`/`FetchOutcome` types (§5) = host-internal, stay in `server/home/`. Cursor Zod schemas stay server-internal (cursors opaque on wire; client ⊥ decodes).

### `home.getLayout`

```ts
// Input
z.object({}).strict(); // no input in v1; userId comes from ctx

// Output
interface HomeLayoutResponse {
  rows: HomeRow[]; // ordered; rules already applied, empties dropped
  generatedAt: number; // ms epoch; client uses for staleness UX
}

interface HomeRow {
  rowId: RowKind; // serves as both the getRowContent identifier and the client-side rendering discriminant
  title: string; // "Continue Watching"
  subtitle?: string; // e.g. "Because you watched Inception" on seed rows
  items: CompactMediaItem[]; // first page, inlined
  cursor: string | null; // null when there is no next page
  partial?: true; // aggregate dispatch had one or more plugin errors
}

type RowKind =
  | "continueWatching"
  | "recommendedForYou"
  | "trendingNow"
  | "newReleases"
  | "becauseYouWatched"
  | "upcomingForYou"
  | "yourWatchlist";
```

### `home.getRowContent`

Called when user scrolls row horizontally past inlined first page. Same per-row fetcher as `getLayout`, not separate code path.

```ts
// Input
z.object({
  rowId: z.enum([...ROW_KINDS]),
  cursor: z.string(), // opaque; came from HomeRow.cursor
}).strict();

// Output
interface RowContentResponse {
  items: CompactMediaItem[];
  cursor: string | null;
  partial?: true;
}
```

### `CompactMediaItem`

Home-feed-specific shape. Overlaps MCP compact shape, adds dashboard-only fields (`backdrop`, `progress`), keeps `episode` optional for `upcomingForYou`. Mapping from `MediaItem` lives in `server/home/compact.ts` — single place this conversion happens.

```ts
interface CompactMediaItem {
  id: string; // "movie:550" | "tv:1396"
  tmdbId: string;
  mediaType: "movie" | "tv";
  title: string;
  year?: number;
  poster?: string; // TMDB proxied URL
  backdrop?: string; // TMDB proxied URL; rows that want large art
  overview?: string; // truncated to ~240 chars
  genres?: string[]; // top 3
  rating?: number; // aggregated; omitted when no source
  userRating?: number; // from ratings@v1; omitted when absent
  matchReason?: string; // only on recommendedForYou / becauseYouWatched
  progress?: { watched: number; total: number }; // only on continueWatching
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  episode?: {
    // only on upcomingForYou items
    season: number;
    episode: number;
    airsAt: number; // ms epoch
    name?: string;
  };
}
```

Absent fields omitted, not null. Same compression discipline as `ent_discover`.

### Error codes

New codes in `HOST_ERROR_CODES`:

| Code                   | When                                                                                                    | Captured? |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| `home.bad_input`       | Invalid `rowId`, malformed cursor, cursor/rowId mismatch                                                | No        |
| `home.row_unavailable` | `getRowContent` called for row user no longer qualifies for (e.g. connection removed mid-session)       | No        |
| `home.internal`        | Thrown inside handler; underlying error propagated for admin viewer                                     | Yes       |

Row-level partial failures (some plugins erroring during aggregate) ⊥ errors — surface as `partial: true`. Full-row failure (zero items from all sources) ⊥ error — degrades to row-omit during `getLayout`, returns `{ items: [], cursor: null }` during `getRowContent` for scroll consistency.

## Layout decision logic

Two concerns: which rows exist & in what order. Both pure functions over signal snapshot. Content fetching separate concern, parallelized after layout decision.

### Signal snapshot

`LayoutSignals` populated by `signals.ts` via parallel cheap reads. Target <50ms P95 whole snapshot.

```ts
interface LayoutSignals {
  // Plugin availability — from capability registry ∩ user connections
  hasWatchHistoryPlugin: boolean;
  hasWatchlistPlugin: boolean;
  hasCalendarPlugin: boolean;
  hasRecommendationsPlugin: boolean;

  // Count signals — cheap reads over cached data, not full fetches
  inProgressCount: number; // 0 if no watchHistory plugin
  watchlistCount: number; // 0 if no watchlist plugin
  calendarProgressCount: number; // in-progress shows with upcoming episodes

  // PreferenceEngine signals — single-row read on preference_profiles
  profileConfidence: "low" | "medium" | "high" | "none";

  // Seed signal — indexed feedback_log / watchHistory query
  recentSeed: {
    id: string; // composite media id "${mediaType}:${tmdbId}" — the single form passed to fetchers
    tmdbId: string;
    mediaType: "movie" | "tv";
    title: string; // resolved from metadata cache
    reason: "high_rating" | "liked" | "recently_completed";
  } | null;
}
```

**Per-signal sources:**

| Signal                  | Source                                                                                                                                                                                                                                                              | Cost         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `hasXPlugin`            | `service_connections` JOIN capability registry; per-user cached                                                                                                                                                                                                     | cache read   |
| `inProgressCount`       | `loader.getInProgressSet().size` — signal computation goes through request-scoped dataloader so `becauseYouWatched` hits warm memoization on page 1 (§7)                                                                                                            | cache read   |
| `watchlistCount`        | `MediaService.getWatchlistCount(userId)` — same pattern                                                                                                                                                                                                             | cache read   |
| `calendarProgressCount` | Derived from in-progress set + at-least-one-future-episode check (see "Calendar cold-cache" below)                                                                                                                                                                  | cache read   |
| `profileConfidence`     | `preference_profiles.confidence` for media_type="combined"; `"none"` if row missing                                                                                                                                                                                 | indexed read |
| `recentSeed`            | `feedback_log` `ORDER BY created_at DESC LIMIT 1` WHERE `action IN ("like", "rate") AND (action != "rate" OR rating >= 8) AND created_at > now-30d`, indexed; fallback to most-recent-completed-within-60d from watchHistory (see "Recency window asymmetry" below) | indexed read |

Two new `MediaService` count methods (`getWatchlistCount`, `getCalendarProgressCount`) — thin read-through wrappers over data already cached at capability layer. One method each, no new capability. `inProgressCount` ⊥ gets dedicated count method — signal computation reads `loader.getInProgressSet()` and takes `.size`, sharing memoization with `becauseYouWatched`'s cross-row exclusion (§7).

**Recency window asymmetry.** Primary path: 30d window; fallback: 60d. Intentional. `like`/high `rate` = active volitional signal, stale fast → tight window. Completed watch = passive signal, weaker per-event → wider window to accumulate enough evidence. Narrowing fallback to 30d → users without recent explicit feedback have no seed.

**Calendar cold-cache.** `calendarProgressCount` "cache read" only when calendar warm. Calendar TTL 1h vs watchHistory 5min → calendar more likely cold. If `getCalendarProgressCount` would trigger live aggregate fetch → signal returns `0`, logs. Drops `upcomingForYou` from current layout; reappears next `getLayout` once cache warms. Preserves <50ms budget at cost of one potentially-missed row on first cold call after TTL expiry.

### Candidate row set

Starts from full v1 catalog, filtered by plugin availability & cheap-signal gates:

```ts
function candidateRows(signals: LayoutSignals): RowKind[] {
  const out: RowKind[] = [];

  if (signals.hasWatchHistoryPlugin && signals.inProgressCount > 0) {
    out.push("continueWatching");
  }
  if (signals.hasRecommendationsPlugin) {
    out.push("recommendedForYou");
  }
  out.push("trendingNow"); // always eligible — works with just TMDB
  out.push("newReleases"); // same
  if (signals.recentSeed) {
    out.push("becauseYouWatched");
  }
  if (signals.hasWatchlistPlugin && signals.watchlistCount > 0) {
    out.push("yourWatchlist");
  }
  if (signals.hasCalendarPlugin && signals.calendarProgressCount > 0) {
    out.push("upcomingForYou");
  }

  return out;
}
```

### Ordering rules

Applied after candidate filtering. Pure function, testable in isolation, swappable for A/B.

```ts
function orderRows(candidates: RowKind[], signals: LayoutSignals): RowKind[] {
  const order: RowKind[] = [];

  // 1. Continue Watching always first if present
  if (candidates.includes("continueWatching")) order.push("continueWatching");

  // 2. Recommended For You vs Trending depends on profile confidence
  const rfyBeforeTrending =
    signals.profileConfidence === "medium" || signals.profileConfidence === "high";
  const rfyPair: RowKind[] = rfyBeforeTrending
    ? ["recommendedForYou", "trendingNow"]
    : ["trendingNow", "recommendedForYou"];
  for (const r of rfyPair) if (candidates.includes(r)) order.push(r);

  // 3. Because You Watched — right after the primary rec rows
  if (candidates.includes("becauseYouWatched")) order.push("becauseYouWatched");

  // 4. The rest — fixed tail
  for (const r of ["yourWatchlist", "newReleases", "upcomingForYou"] as const) {
    if (candidates.includes(r)) order.push(r);
  }

  return order;
}
```

### Drop-empty safety net

After per-row fetches complete, drop any row with empty `items`. Handles signal drift — cache said non-empty, fetch returned zero. One exception:

```ts
type FetchOutcome = "ok_items" | "ok_empty" | "partial" | "timeout" | "all_failed";

interface FetchedRow {
  rowId: RowKind;
  title: string;
  subtitle?: string;
  items: CompactMediaItem[];
  cursor: string | null;
  outcome: FetchOutcome;
  partial?: true; // redundant with outcome === "partial" but kept on the wire per §4
}

function dropEmpty(rows: FetchedRow[]): FetchedRow[] {
  return rows.filter(
    (r) => r.items.length > 0 || (r.rowId === "upcomingForYou" && r.outcome === "ok_empty"),
  );
}
```

`FetchedRow` = layout orchestrator's internal shape, assembled from `RowFetcher.fetch` return plus orchestrator knowledge (did call complete within timeout, did all plugins fail, etc.). Orchestrator strips `outcome` when mapping to wire-level `HomeRow` — clients see only `items`, `cursor`, `partial`. `outcome` = host-internal discriminant for drop-empty logic & observability.

**`FetchOutcome` assignment.** `RowFetcher.fetch` returns `{ items, cursor, partial? }` or throws; ⊥ knows whether timed out, cancelled, or all upstream plugins failed. Orchestrator wraps every fetch dispatch:

```ts
async function runFetch(fetcher: RowFetcher, ctx, opts): Promise<FetchedRow> {
  try {
    const result = await Promise.race([
      fetcher.fetch(ctx, opts),
      timeout(3000).then(() => TIMEOUT_SENTINEL),
    ]);
    if (result === TIMEOUT_SENTINEL) return { ...empty(fetcher), outcome: "timeout" };
    // Order matters: "partial" wins over "ok_empty" when items is empty but some
    // plugins errored — otherwise upcomingForYou's drop-empty exemption would
    // render "you're caught up" copy during a calendar plugin outage.
    const outcome: FetchOutcome = result.partial
      ? "partial"
      : result.items.length === 0
        ? "ok_empty"
        : "ok_items";
    return { ...map(fetcher, result), outcome, partial: result.partial };
  } catch (err) {
    // AllPluginsFailedError is defined in media-service-design.md and thrown by
    // aggregate MediaService methods when every contributing plugin errored;
    // anything else caught here is an orchestrator-level fault.
    if (err instanceof AllPluginsFailedError) {
      return { ...empty(fetcher), outcome: "all_failed" };
    }
    throw err; // bubbles to home.internal
  }
}
```

`ok_items`/`ok_empty`/`partial` from shape of successful return; `timeout` from 3s `Promise.race`; `all_failed` from specific `MediaService` aggregate error. Only place `FetchOutcome` values assigned — row fetchers ⊥ see or set field.

`upcomingForYou` exempt **only when fetch succeeded & genuinely returned zero items** (`outcome === "ok_empty"`) — "No upcoming episodes" = meaningful info user was looking for. Timeout/all-plugins-failed → drop like any other row.

### A/B hook

```ts
function resolveLayoutOrder(signals: LayoutSignals): RowKind[] {
  return orderRows(candidateRows(signals), signals);
}
```

Everything upstream of fetch pure. Variant = different `resolveLayoutOrder`; experiment selection once in layout handler, ⊥ touches fetch code. No experiment infra v1, but shape built for it.

### Timeline

```
t=0      start
t=~30ms  signal snapshot complete (parallel reads)
t=~30ms  candidateRows + orderRows computed (synchronous)
t=~30ms  per-row fetches dispatched in parallel through dataloader
t=~???   slowest row completes (typically 200–800ms for aggregate rows)
         ← response bounded by slowest row
t=~???   dropEmpty + response assembly (<5ms)
```

Hard per-row fetch timeout: 3s. Timeout → treated as empty → drop-empty applies.

## Row catalog

One file per row under `server/home/rows/` implementing `RowFetcher`.

| Row                 | Capability & method                                     | Strategy          | Cursor       | First page | Max items | Extra fields            |
| ------------------- | ------------------------------------------------------- | ----------------- | ------------ | ---------- | --------- | ----------------------- |
| `continueWatching`  | `watchHistory@v1.getInProgress`                         | aggregate         | offset       | 20         | 100       | `progress`              |
| `recommendedForYou` | `recommendations@v1.get` → PreferenceEngine re-rank     | aggregate         | page+exclude | 20         | 60        | `matchReason`, `status` |
| `trendingNow`       | `recommendations@v1.getTrending`                        | aggregate         | page         | 20         | 60        | `status`                |
| `newReleases`       | `metadata@v1.discover` (recent-release filter)          | primary_with_enr. | page         | 20         | 60        | `status`                |
| `becauseYouWatched` | `metadata@v1.getSimilar` (seed from signals.recentSeed) | primary_with_enr. | page+seed    | 20         | 40        | `matchReason`, `status` |
| `upcomingForYou`    | `calendar@v1.getUpcoming` (in-progress shows only)      | aggregate         | afterTmdbId  | 20         | 60        | `episode`               |
| `yourWatchlist`     | `watchlist@v1.list`                                     | aggregate         | offset       | 20         | 200       | `status`                |

∀ rows batch `status` via single `mediaRequest@v1.getStatusBatch` call per page, coalesced across rows within single request via dataloader (§7).

### Per-row details

**`continueWatching`**

- `MediaService` method: `getInProgress(userId, { cursor, limit })` — new `watchHistory@v1` method. Returns items with `watched_ms`/`duration_ms`. Plugins not implementing → skipped in aggregate (backward-compatible).
- Within-row dedupe by `(tmdbId, mediaType)`; most-recent-progress wins on overlap.
- No PreferenceEngine re-rank — in-progress list ⊥ discovery surface.
- Order: most-recently-watched first.
- `progress` field: omit entirely when `duration_ms` missing/zero/negative. Item still included — in-progress from plugin perspective, progress unmeasurable. Server-client contract: absent `progress` = "in-progress item, progress unmeasurable." ⊥ `{ watched: 0, total: 0 }` or NaN. Rendering (progress bar vs. generic play affordance) = frontend spec concern.

**`recommendedForYou`**

- Fetches `limit × 3` candidates per page (same over-fetch-then-prune as `ent_discover`), runs `PreferenceEngine.rankCandidates`, takes top `limit`, calls `explainMatch` only for returned top-N.
- Empty case: requires ≥1 connected `recommendations@v1` plugin — "has feedback, no plugin" → empty every time → filtered in candidate selection, not admitted and silently dropped. Plugin exists but profile thin → upstream results pass through, `matchReason` omitted, row renders.
- Pagination: exclusion list in cursor prevents duplicates across scroll pages when ranking shifts (§7).

**`trendingNow`**

- No PreferenceEngine re-rank — "everyone agrees this is popular" row. Distinct from `recommendedForYou`.
- `recommendations@v1.getTrending` — backward-compatible method addition per MCP spec.

**`newReleases`**

- `metadata@v1.discover` with fixed filters: `release_date.gte = now - 90d`, `release_date.lte = now`, sort popularity desc.
- Mixes movies & TV v1. `media_type` filter not exposed; client-side filter on `CompactMediaItem.mediaType` optional later.

**`becauseYouWatched`**

- Subtitle dynamic: `"Because you watched ${signal.recentSeed.title}"`. Only row with dynamic subtitle.
- Seed selection in `signals.ts`, not this fetcher — same signal consumed by candidate filtering.
- Seed can go stale between `getLayout` calls. Next `getLayout` picks up new seed.
- Seed threaded into fetcher **through cursor, not side channel**. First page: layout handler synthesises `{ v: 1, r: "becauseYouWatched", p: 1, s: signals.recentSeed.id }`, passes as `opts.cursor` instead of `null`. Scroll pages: client echoes `s` from previous page. Fetcher reads seed from `cursor.s` only — single code path across `getLayout` & `getRowContent`, ⊥ `RowFetchContext` needs to expose `LayoutSignals`.
- Seed **pinned** via cursor's `s` within scroll session. `getRowContent` reads `s`, calls `metadata@v1.getSimilar(seed, { page })` against specific seed, ignores live `signals.recentSeed` drift.
- TMDB `/similar` paginated by `page`; trivial cursor.
- Cross-row exclusion: fetcher excludes any item whose `(tmdbId, mediaType)` ∈ user's current in-progress set. `RowFetchContext` ⊥ exposes signal snapshot to fetchers, so both page 1 & scroll pages obtain set via `ctx.dataloader.getInProgressSet()` — dataloader-memoized read-through over `mediaService.getInProgress(userId)` returning `Set<MediaId>`. Page 1 hits warm memoization (signal computation already called same method). Exclusion applies every page. Trending + New Releases overlap deliberately ⊥ filtered.

**`upcomingForYou`**

- ⊥ subtitle at row level; per-item `episode` field carries detail.
- Scoped to shows user currently in progress (from cached in-progress set).
- Cursor: `afterTmdbId` — aggregate results across calendar plugins lack stable page notion.
- Exempt from drop-empty (§5).

**`yourWatchlist`**

- Sort: most-recently-added first. Overridable via row-level preference later; ⊥ v1.
- `maxItems: 200` — users with long watchlists expect all reachable. Past 200, UI should offer "go to watchlist" affordance.

### Dedupe rules

- **Within-row:** dedupe by `(tmdbId, mediaType)` after aggregate merge. Always.
- **Within scroll pages:** cursor page/afterId/exclusion-list logic per row.
- **Cross-row:** ⊥ deduped v1. Accept "Inception" in both Trending & New Releases. Cheap retrofit if noisy.

## Caching, pagination, and request coordination

### Caching layers

Three layers, each with one job.

| Layer                      | Scope                                     | TTL                   | Purpose                                         |
| -------------------------- | ----------------------------------------- | --------------------- | ----------------------------------------------- |
| `MediaService` LRU / Redis | Global, per-capability                    | Per MediaService spec | Cross-request cache for capability call results |
| Request-scoped dataloader  | Single `getLayout` / `getRowContent` call | Request lifetime      | Cross-row dedupe within a single request        |
| PreferenceEngine profile   | Per user (existing)                       | Written at rebuild    | Score data; no new cache                        |

**No new home-feed-level cache v1.** Per-row `MediaService` TTLs handle most win; layout-level cache complicates invalidation on feedback events for marginal improvement.

### Per-row TTLs

All inherited from capability layer; none overridden.

| Row                 | Underlying capability | TTL                                            |
| ------------------- | --------------------- | ---------------------------------------------- |
| `continueWatching`  | `watchHistory@v1`     | 5 min                                          |
| `recommendedForYou` | `recommendations@v1`  | 6 h (candidates); re-rank runs fresh each call |
| `trendingNow`       | `recommendations@v1`  | 6 h                                            |
| `newReleases`       | `metadata@v1`         | 24 h                                           |
| `becauseYouWatched` | `metadata@v1`         | 24 h (keyed on seed id)                        |
| `upcomingForYou`    | `calendar@v1`         | 1 h                                            |
| `yourWatchlist`     | `watchlist@v1`        | 5 min                                          |

`recommendedForYou` detail: candidate list cached 6h, but `PreferenceEngine.rankCandidates` runs fresh each request. Profile changes take effect next `getLayout` without touching candidate cache. No invalidation plumbing needed.

### Request-scoped dataloader

Memoization keyed on `(method, argsHash)`, userId implicit in request scope. Lives one `getLayout`/`getRowContent` call, then discarded.

```ts
class RequestScopedLoader {
  constructor(
    private mediaService: MediaService,
    private userId: string,
  ) {}
  private pending = new Map<string, Promise<unknown>>();

  getMetadata(id: MediaId) {
    /* memoize over MediaService.getMetadata */
  }
  getStatusBatch(ids: MediaId[]) {
    /* coalesce + batch */
  }
  getInProgressSet(): Promise<Set<MediaId>> {
    /* memoize: MediaService.getInProgress(this.userId) → Set<MediaId> */
  }
  hasPlugin(capability: PluginRequirement): Promise<boolean> {
    /* memoize: service_connections ∩ capability registry lookup for this.userId */
  }
  private memoize<T>(method: string, args: unknown, fn: () => Promise<T>): Promise<T> {
    const key = `${method}:${hash(args)}`;
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn();
    this.pending.set(key, p);
    return p;
  }
}
```

Four methods with special handling:

- **`getMetadata`** — straight memoization. Two rows needing same title → one underlying call.
- **`getStatusBatch`** — microtask-level coalescing. Each row calls during fetch; loader collects calls arriving same microtask, flushes via `queueMicrotask()`. Unions id set, fires one `mediaRequest@v1.getStatusBatch`, splits response per caller. Coalescing latency sub-millisecond.
- **`getInProgressSet`** — memoized read-through, returns `Set<MediaId>`. Single source for per-request in-progress set. Signal computation calls first → `becauseYouWatched` hits warm memoization page 1 — zero additional plugin work. `calendarProgressCount` ⊥ shares this memoization (comes from `MediaService.getCalendarProgressCount` with its own cross-reference against calendar data).
- **`hasPlugin(capability)`** — memoized lookup over `service_connections ∩ capability registry` for `this.userId`. Same table backs signal computation's `hasXPlugin` booleans. Memoization: two rows checking same capability → one read.

**Status call timeout budget.** Coalesced `getStatusBatch` call: 1s cap (tighter than 3s per-row — status = enrichment, rows ⊥ sacrifice entire budget to it). On timeout/full failure → `status` omitted on all items. `partial: true` ⊥ set for this case — status ⊥ core row content. Genuine aggregate partial failures from underlying `mediaRequest@v1.getStatusBatch` (some plugins error, others succeed) → status present for items where ≥1 plugin responded.

### Cursor format

Opaque base64-encoded JSON, versioned. Four variants:

```ts
// page-based (trendingNow, newReleases)
{ v: 1, r: "trendingNow", p: 2 }

// offset-based (continueWatching, yourWatchlist)
{ v: 1, r: "yourWatchlist", o: 40 }

// afterTmdbId-based (upcomingForYou)
{ v: 1, r: "upcomingForYou", a: "tv:1396", ts: 1713820000000 }

// page + seed (becauseYouWatched only)
// Page 1 is the layout-synthesised initial cursor (see below);
// page 2+ are the client echoing the cursor it received on the previous page.
{ v: 1, r: "becauseYouWatched", p: 1, s: "movie:550" } // initial, from layout handler
{ v: 1, r: "becauseYouWatched", p: 2, s: "movie:550" } // scroll, from client

// page + exclusion list (recommendedForYou only)
{ v: 1, r: "recommendedForYou", p: 2, x: ["movie:550", "tv:1396", ...] }
```

**`upcomingForYou` `ts` field.** Item = upcoming episode of in-progress show. Multiple upcoming episodes of same show share `tmdbId` but differ in `airsAt`. `ts` carries `airsAt` of last returned item in previous page; server pagination uses `(tmdbId, airsAt) > (cursor.a, cursor.ts)` as composite ordering key. Without `ts` → duplicates or skipped episodes.

**`becauseYouWatched` `s` field.** Seed delivered to fetcher exclusively through cursor — including page 1. During `getLayout`, layout handler synthesises initial cursor `{ v: 1, r: "becauseYouWatched", p: 1, s: signals.recentSeed.id }`, passes as `opts.cursor`. Fetcher single code path: decode cursor, read `s`, call `metadata@v1.getSimilar(seed, { page: cursor.p })`. No "cursor null → page 1 → pull seed from some other context" branch. `s` carries media id (`"movie:550"` or `"tv:1396"`), echoed unchanged ∀ scroll pages; `getRowContent` reads `s`, decodes to `(tmdbId, mediaType)`, uses specific seed even if `signals.recentSeed` shifted. Row subtitle stable for scroll session; new seed surfaces next `getLayout`. Same `s` is what `isEligible` resolves against in §8.

### Cursor validation

Cursors = untrusted client input. ∀ decodes run Zod schema **before any business logic touches payload**. Schema enforces:

- `v === 1`.
- `r` ∈ `RowKind` enum values.
- Variant-appropriate fields: `p` non-negative integer capped at `maxItems / pageSize`; `o` non-negative integer capped at `maxItems`; `a` & `s` match `movie:NNN`/`tv:NNN` pattern; `ts` positive integer ms epoch; `x` string array with `items <= maxItems` (60), each entry matching media-id pattern.
- No extra keys (strict parsing).

| Outcome                                                     | Result                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Malformed base64 / non-JSON / fails Zod validation          | `home.bad_input`                                            |
| Cursor's `r` doesn't match `rowId` in request input         | `home.bad_input`                                            |
| Decoded page/offset lies beyond `maxItems`                  | `{ items: [], cursor: null }` — graceful stop, not error    |
| Decoded position past end of underlying data                | same graceful stop                                          |

Decode-side cap on `x[]` & `p`/`o` load-bearing: crafted cursor with 10k entries in `x` → O(candidates × 10k) filter. Zod rejects before allocation/dispatch.

Cursors ⊥ expire & **⊥ HMAC-signed**. Risk analysis:

- oRPC endpoint authenticates via session; `userId` from `ctx.user.id`, ⊥ from cursor. Client ⊥ paginate against another user's data by replaying captured cursor — needs that user's session token.
- What client can do: craft valid cursors for own account. Worst achievable within validated shape: "skip to page 3" or "exclude titles I never saw" — affects only own view, ⊥ access they don't already have.
- Real threat from untrusted cursor input: decode-time DoS (crash on malformed, memory pressure from oversized). Zod validation + hard length caps handle directly.
- HMAC signing adds secret management, rotation, per-request CPU cost to solve attack session-auth already prevents. Deliberately not adopted.

If threat model changes (e.g. cursor used as capability token in different surface), signing = mechanical retrofit — encode becomes `base64(payload || hmac(secret, payload))`, decode verifies first. No cursor-shape change.

### `recommendedForYou` exclusion list

Re-ranking every page risks duplicates across scroll pages: item ranked 15 page 1 may rank 21 page 2 if profile updated. Cursor carries IDs returned on prior pages; server excludes before responding.

Bounds: exclusion list capped at `maxItems` (60), enforced on **both encode & decode** per cursor-validation schema. Cursor stays under ~2KB encoded. Only `recommendedForYou` uses this variant.

### Timeouts

- **Per-row fetch:** 3s hard cap. On timeout → treated as empty → drop-empty applies.
- **`getLayout` overall:** bounded by slowest row (≤3s) + minor overhead.
- **`getRowContent`:** 3s flat. On timeout → `{ items: [], cursor: null }` — same graceful end-of-pagination shape as "decoded position past end" & "all plugins errored." Timeout logged, ⊥ promoted to `home.internal`.

### Concurrency and fairness

Single `getLayout` fans out ≤7 aggregate calls, each potentially hitting multiple plugins. Per-plugin rate-limit accounting applies. No new concurrency primitive introduced.

## Empty states and degradation

### User-state taxonomy

| State                                              | Rows that render                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No plugins, no shared creds**                    | `rows: []` — client renders onboarding empty state                                                                                                       |
| **TMDB via shared admin key only** (day-zero)      | `newReleases` always; `becauseYouWatched` if feedback seed exists                                                                                        |
| **TMDB + feedback signal but no trackers**         | `newReleases`, `becauseYouWatched`, and `recommendedForYou` (thin profile → low-confidence re-rank) if plugin implementing `recommendations@v1` exists    |
| **TMDB + tracker (e.g. Trakt)**                    | All seven rows eligible, subject to per-row content checks                                                                                               |
| **Full install (TMDB + Trakt + Seerr + calendar)** | All seven rows                                                                                                                                           |

Each transition driven by signal computation & candidate filter §5. Nothing special-cases "user just connected X" — next `getLayout` picks it up.

### Empty layout

When `rows` empty after filtering & drop-empty:

```json
{ "rows": [], "generatedAt": 1713820000000 }
```

Client responsible for empty-state UX. Already knows user's connection state via `/connections` oRPC. No `guidance` field — avoids duplicating knowledge that lives in connections layer.

### Degradation matrix

| Failure mode                                           | Row behavior                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Required capability has zero connected plugins         | Row filtered out in candidate selection (pre-fetch)                                                                             |
| Cheap-signal count is zero                             | Row filtered out in candidate selection                                                                                         |
| Aggregate with partial plugin failure                  | Row renders with returned data + `partial: true`                                                                                |
| Aggregate with all plugins failing                     | Row empty; drop-empty removes it (including `upcomingForYou` — see below)                                                       |
| Aggregate returning zero items (all plugins succeeded) | Row dropped by drop-empty, **except** `upcomingForYou` retained with `items: []` (meaningful "you're caught up" state)          |
| Primary-with-enrichment primary fails                  | Row empty; dropped                                                                                                              |
| `becauseYouWatched` seed doesn't resolve in metadata   | Row dropped; signal clears seed for subsequent calls                                                                            |
| Per-row 3s timeout exceeded                            | Row treated as empty; dropped                                                                                                   |
| `PreferenceEngine.explainMatch` fails for item         | `matchReason` omitted on that item; row otherwise unaffected                                                                    |
| `PreferenceEngine.rankCandidates` fails                | Fall back to upstream aggregate order; log; row still renders                                                                   |
| Signal computation partial failure                     | Failing signal defaults (0 / `"none"`); log; layout proceeds                                                                    |
| Signal computation total failure (DB down)             | `getLayout` throws `home.internal` (captured)                                                                                   |
| `mediaRequest@v1.getStatusBatch` fails                 | `status` omitted on items; rows otherwise unaffected                                                                            |
| `PreferenceEngine` entirely unavailable                | `recommendedForYou` renders via upstream order; `matchReason` absent                                                            |

Principle: **degrade silently at row level, fail loudly at infra level.** Plugin down = product behavior; DB down = incident.

### `partial: true` signaling

Set on row when `MediaService` returned aggregate errors alongside data. Client renders subtle affordance ("some sources unavailable"), deep-links to `/connections`. ⊥ specific error messages — Connections page's job per error-management doc.

⊥ promoted to top-level response field; keeping signal on row preserves locality.

### Plugin-connection changes during session

When user enables/disables/removes connection via `/connections`, subsequent `getLayout` reflects new state (signals recompute, rows filter accordingly). Stale `getRowContent` cursors for dropped row → `home.row_unavailable`. Consistent with connection-change cache-invalidation hook from `MediaService` doc.

**Eligibility re-check on `getRowContent`.** ⊥ re-run full `LayoutSignals` snapshot on every pagination call — ~50ms snapshot on horizontal-scroll = wasted work. Each `RowFetcher` declares cheap `isEligible(userId, loader)`:

- `continueWatching` — `loader.hasPlugin("watchHistory@v1")`.
- `yourWatchlist` — `loader.hasPlugin("watchlist@v1")`.
- `upcomingForYou` — `loader.hasPlugin("calendar@v1")`. `calendarProgressCount > 0` gate from `candidateRows` intentionally ⊥ mirrored: mid-session user may have caught up → count drops to zero → should render row with `outcome: ok_empty` ("you're caught up"), not `home.row_unavailable`. Plugin-presence check governs eligibility; count gate = layout-time optimization to skip fetch when guaranteed empty.
- `recommendedForYou`, `trendingNow` — `loader.hasPlugin("recommendations@v1")`. `candidateRows` gates RFY strictly on plugin presence (profile-only fallback out of scope v1), so `isEligible` mirrors that — no profile-exists escape hatch.
- `becauseYouWatched` — verify seed media id in cursor's `s` still resolves via `metadata@v1.getById`. Uses cursor-pinned seed, not live `signals.recentSeed` — pagination ! be consistent with page 1 even when seed shifted.
- `newReleases` — always eligible; returns `true` unconditionally. `metadata@v1` assumed present; if not, row fetch empties, call returns `{ items: [], cursor: null }` rather than `home.row_unavailable`.

∀ `hasPlugin` calls through `RequestScopedLoader.hasPlugin` (§7) — sub-5ms, two rows checking same capability → one read. `isEligible` contract: one method per row; implementations in each row fetcher file.

Failed eligibility → `home.row_unavailable` immediately, ⊥ touching plugin runtime. Cursor past data (normal end-of-pagination) → `{ items: [], cursor: null }` — eligibility ≠ "is there more content."

### Feedback events during session

`ent_feedback` writes to `feedback_log`, triggers `PreferenceEngine` incremental-update job. Feed ⊥ self-invalidates:

- Candidate-list cache in `MediaService` untouched by feedback.
- Profile used by `rankCandidates` refreshes when incremental job runs (~30s debounce). Next `getLayout` picks it up.
- `recentSeed` for `becauseYouWatched` updates next `getLayout`.

Small window (≤~30s) where user gives feedback & next home load still shows old ranking. Acceptable — matches preview-vs-authoritative pattern from PreferenceEngine spec.

### First-visit / cold-cache behavior

First-ever `getLayout` warms all per-row caches. P95 upper bound: 3s (timeout cap). Subsequent visits within TTL: ~100–500ms depending on how many rows need revalidation.

No "show skeleton, reload later" v1 — row either returned or not. Cache pre-warm on connection-create = small addition; deferred.

## `MediaService` and capability additions

All backward-compatible. Plugins not implementing new capability method → skipped in aggregate per existing MediaService semantics.

### New `MediaService` methods

Thin read-throughs; no new capability.

- `getWatchlistCount(userId): Promise<number>` — count of `watchlist@v1.list` items, from capability cache.
- `getCalendarProgressCount(userId): Promise<number>` — count of in-progress shows with ≥1 future episode, derived from watchHistory in-progress set cross-referenced with calendar data.

### New capability methods

- `watchHistory@v1.getInProgress(userId, { cursor, limit })` — returns in-progress items with `watched_ms` & `duration_ms`. Backward-compatible addition.
- `mediaRequest@v1.getStatusBatch(userId, ids: MediaId[])` — batched `getStatus` returning `Record<MediaId, status>` keyed on same `MediaId` strings (`"movie:550"`, `"tv:1396"`) as `ids` — not bare `tmdbId` integers. Symmetric keyspace prevents split bug in dataloader when fanning coalesced response back to per-row callers. Plugins not implementing → skipped; status falls back to `"unknown"`.

### Pre-existing but referenced

- `recommendations@v1.getTrending({ mediaType?, limit, cursor })`
- `metadata@v1.discover({ filters, sort, limit, cursor })`

## Testing

One test file per unit. Favor small, fast unit tests over integration; one end-to-end path per user-state fixture.

### Signal computation (`signals.test.ts`)

- Each signal independently: fixture DB state + mocked `MediaService` → expected value.
- Partial failures: one signal source errors → signal defaults, others complete normally.
- Total DB failure: snapshot throws → caller propagates as `home.internal`.
- `recentSeed` fallback chain: high-rating → like → recently-completed → null.

### Layout rules (`rules.test.ts`)

Pure-function tests, no mocks.

- `candidateRows(signals)` for representative snapshots (zero-plugin, TMDB-only, full-install).
- `orderRows(candidates, signals)` across confidence matrix (none/low/medium/high), verifying RFY ↔ Trending swap.
- Static tail ordering: `yourWatchlist`, `newReleases`, `upcomingForYou` always in that relative order.
- Snapshot test on full (signal snapshot → expected row order) table for v1 rule set.

### Row-fetcher contract tests

One file per row under `rows/*.test.ts`. ∀ rows exercise:

- Happy path: fixture plugin returns data → row returns `CompactMediaItem[]` in correct shape.
- Within-row dedupe: overlapping items from two plugins → single entry (most-recent-progress wins where applicable).
- Cursor roundtrip: `fetch(null)` → `cursor X` → `fetch(X)` → `cursor Y` → eventually null.
- Max-items cap: pagination stops at declared `maxItems`.
- Per-row timeout: slow plugin → `{ items: [], cursor: null }`.
- Partial aggregate: one failing + one succeeding plugin → merged data with `partial: true`.

Row-specific:

- `continueWatching`: `progress` populated when `duration_ms > 0`; items with missing/zero/negative `duration_ms` **included** with `progress` absent (matches §6 contract); `duration_ms = 0` → returned, `progress` key absent; sorted most-recent-watched-at first.
- `recommendedForYou`: candidate over-fetch = limit × 3; `rankCandidates` called once; `explainMatch` only for top-N; thin profile → `matchReason` omitted, row renders.
- `becauseYouWatched`: subtitle contains seed title; seed resolution failure on `getLayout` → row drops cleanly; `isEligible` with cursor `s` no longer resolving → returns `false`; `isEligible` with still-resolvable `s` → returns `true` even when `signals.recentSeed` shifted.
- `recommendedForYou` exclusion: page 2 cursor carries ~20 IDs from page 1; page 2 excludes them; exclusion list capped at `maxItems`.

### Dataloader (`dataloader.test.ts`)

- Same `getMetadata(id)` called twice within one request → one underlying call.
- `getStatusBatch` coalescing: three rows each call with disjoint ID sets → one combined upstream call → correct per-caller split.
- `getStatusBatch` return: keys match input `MediaId` strings verbatim (`"movie:550"`, ⊥ `"550"`).
- `getInProgressSet` memoization: two callers → one underlying `getInProgress` call; returns `Set<MediaId>`; no `userId` param — uses loader's constructor-scoped user.
- `hasPlugin` memoization: two rows checking same capability → one lookup; distinct capabilities → distinct lookups; returns `boolean`.
- Error propagation: underlying call fails → ∀ awaiting callers receive same error.
- Non-dataloader methods ⊥ memoized.

### Cursor (`cursor.test.ts`)

- Encode/decode roundtrip for each variant (page, offset, afterTmdbId, page+seed, page+exclusion).
- Malformed base64 → `home.bad_input`.
- Version mismatch → `home.bad_input`.
- `rowId` mismatch → `home.bad_input`.
- Zod rejects cursor with extra keys (strict parsing).
- Exclusion-list size cap enforced on **decode** (crafted cursor with 10k entries in `x[]` → `home.bad_input`).
- Exclusion list size cap enforced on encode.
- `upcomingForYou` decode without `ts` → `home.bad_input`.
- `becauseYouWatched` decode without `s` → `home.bad_input`.
- `becauseYouWatched` `s` field with malformed media id → `home.bad_input`.
- `becauseYouWatched` pagination continuity: cursor `s` carries forward unchanged across pages even when `signals.recentSeed` would change mid-session.
- `becauseYouWatched` layout-synthesised initial cursor: given `LayoutSignals` with `recentSeed = { tmdbId: "550", mediaType: "movie", ... }`, layout handler encodes `{ v: 1, r: "becauseYouWatched", p: 1, s: "movie:550" }`, passes as `opts.cursor` — round-trips through same encode/decode path as client-supplied cursors, accepted by Zod unchanged.
- `becauseYouWatched` initial cursor ⊥ null: layout handler ! not invoke `becauseYouWatched` fetcher with `opts.cursor === null`. Test-double fetcher asserts cursor received page 1 decodes to `{ p: 1, s: <seed id> }`; fetcher reads `s` from cursor only.

### `HomeFeedService` integration tests (`home-feed-service.test.ts`)

One test per user-state fixture:

- **No plugins:** `getLayout` → `rows: []`.
- **Shared TMDB only:** `getLayout` → `newReleases` only.
- **TMDB + feedback signal, no trackers:** `newReleases` + `becauseYouWatched` + `recommendedForYou` (thin).
- **TMDB + Trakt:** full eligible set, correct ordering per profile confidence.
- **Full install mid-rebuild:** reads current profile; ranking reflects stale-but-valid profile; no error.
- **Calendar cold-cache:** `calendarProgressCount` returns 0; `upcomingForYou` dropped; no error.
- **`upcomingForYou` timeout vs ok-empty vs partial-empty:** timeout → dropped; genuine empty fetch (all plugins succeeded, zero items) → retained `items: []`; some calendar plugins fail & successful ones return zero → dropped (outcome = `partial`, exemption ⊥ fires).
- **`getRowContent` eligibility re-check:** plugin removed between `getLayout` & `getRowContent` → `home.row_unavailable`; plugin present, cursor past end → `{ items: [], cursor: null }`.
- **`getRowContent` timeout:** slow underlying fetch >3s → `{ items: [], cursor: null }` (no error thrown).
- **Cross-row exclusion:** in-progress item ⊥ appears in `becauseYouWatched` page 1 or scroll page 2; both pages call `ctx.dataloader.getInProgressSet()`; test asserts single underlying `mediaService.getInProgress(userId)` call across signal computation + fetcher invocation (memoization holds).

∀ fixtures assert row set, order, which rows carry `matchReason`/`progress`/`partial`.

### API contract tests

- oRPC input schema: `getLayout` rejects extra keys (strict); `getRowContent` requires `rowId` & `cursor`; unknown `rowId` → `home.bad_input`.
- oRPC output schema matches published type in `@ent-mcp/shared`; no extraneous fields.
- Shape stability: snapshot test on canonical fixture response.

### Degradation integration

- ∀ capability's aggregate with one plugin failing → `partial: true` on corresponding row.
- All plugins for capability fail → row dropped (exception: `upcomingForYou` only when `ok_empty`).
- `upcomingForYou` genuine empty fetch → row retained `items: []`.
- `upcomingForYou` timing out → row dropped (⊥ retained as empty).
- `upcomingForYou` partial-empty (mixed plugin failure, zero items from survivors) → row dropped; outcome = `partial` → `ok_empty` exemption ⊥ fires.
- `getRowContent` for row unavailable since layout → `home.row_unavailable`.
- Cursor past end → `{ items: [], cursor: null }`, not error.
- `getStatusBatch` >1s → `status` omitted on affected items; row still returned; `partial` ⊥ set.

### Not tested here

- `MediaService` behavior under partial failures — MediaService suite.
- `PreferenceEngine` ranking correctness — PreferenceEngine suite.
- Plugin runtime sandboxing — plugin-runtime suite.
- Job-service coalescing of incremental updates — job-service suite.

## Open questions / deferred

- **Billboard hero unit.** Additive `layout.hero` field. Reserved for later spec.
- **Cross-row dedupe.** ⊥ applied v1. If "same title in Trending & New Releases" noisy, add seen-set at tail of layout handler.
- **Personalized row ordering beyond rule table.** Requires engagement tracking ruled out by PreferenceEngine spec.
- **Genre-scoped rows.** Defer until `preference_profiles` data strong enough.
- **Streaming / progressive loading.** Synchronous v1. If slow row becomes P95 problem, per-row SSE = clean retrofit — `RowFetcher` shape already row-local.
- **Layout-level caching per user.** ⊥ worth it until per-row TTLs prove insufficient.
- **Cache pre-warm on connection-create.** First `getLayout` after connecting warms cache cold. Add hook if cold-load UX visibly bad.
- **Dashboard rate limiting.** ⊥ introduced here. Extend same token-bucket primitive used for MCP to oRPC if needed.
- **A/B variants on rule table.** Pure-function shape built for it; no experiment infra wired v1.
- **MCP equivalent.** MCP agents already get home-equivalent via `ent_discover`; dedicated `ent_home` would duplicate surface — ⊥ planned.

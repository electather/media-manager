# Home Feed

**Status:** Draft for review
**Date:** 2026-04-22
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md` (media-service.md), `2026-04-20-preference-engine-design.md`, `2026-04-19-frontend-connections-design.md`, `2026-04-19-error-management-design.md`, `mcp-server.md`

## Summary

The Home Feed is the server-side surface behind the dashboard's Netflix-style home page: a stack of themed rows (Continue Watching, Recommended For You, Trending Now, etc.) composed from plugin-provided capabilities and re-ranked against the user's preference profile. This document specifies two oRPC procedures (`home.getLayout` and `home.getRowContent`), a `HomeFeedService` that orchestrates existing `MediaService` and `PreferenceEngine` calls into a uniform row catalog, and the caching / pagination / degradation behaviors that tie the whole surface together.

Scope is strictly server-side: endpoints, backing logic, data shapes, and behavioral rules. The frontend that consumes this surface — card layouts, scroll interactions, skeletons, empty-state copy — is a separate spec.

The design follows the discipline of the MCP spec: a thin translation layer over `MediaService` with no new dispatch, runtime, credential, or cache infrastructure introduced below it. Seven rows ship in v1. Layout decisions are pure functions of a cheap signal snapshot and can be swapped for A/B variants without touching data-fetching code.

## Goals

- Ship a server-composed home feed as two oRPC procedures for the dashboard.
- Reuse `MediaService`, `PreferenceEngine`, and existing capability methods. Introduce no new capability, plugin contract, or database table.
- Degrade gracefully across the full spectrum of user states: no plugins, TMDB-only, tracker-connected, full install.
- Keep layout decisions pure functions — easy to test, cheap to A/B, safe to swap.
- Match the token-efficiency and error-handling discipline of the MCP spec (compact response shapes, `UserFacingError`).

## Non-goals

- Frontend design. Card shape, scroll behavior, skeleton UX, empty-state copy, and visual rendering are all owned by a later frontend spec.
- Billboard hero unit. Deferred; `layout.hero` is an additive field whenever we ship it.
- Genre-scoped rows (e.g. "More Crime Dramas"). Deferred until `preference_profiles` data is dense enough to pick well.
- Personalized row ordering from engagement tracking. Explicitly ruled out per the PreferenceEngine spec's "no things-we-showed-this-user tracking" stance.
- Cross-row deduplication. v1 accepts that a title may appear in both Trending and New Releases.
- Streaming / SSE responses. All procedures are synchronous request/response in v1.
- MCP surface. MCP agents already get home-page-equivalent behavior via `ent_discover` with `mode=recommend | trending`; the Home Feed is dashboard-only.
- Dashboard rate limiting. Not introduced here; inherits whatever the general oRPC layer has.

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

`HomeFeedService` is a small orchestrator. It reads cheap signals, decides the row layout via a pure-function rule table, dispatches per-row content fetches in parallel, and assembles a response. Each row is one `RowFetcher` entry — same file-per-fetcher pattern the PreferenceEngine uses for its `FeatureScorer` registry.

### `RowFetcher` interface

```ts
interface RowFetcher {
  rowId: RowKind;
  title: string;
  requires: PluginRequirement[]; // e.g. ["watchHistory@v1"]; empty = no deps
  fetch(
    ctx: RowFetchContext,
    opts: { cursor: string | null; limit: number },
  ): Promise<{ items: CompactMediaItem[]; cursor: string | null; partial?: true }>;
}
```

`RowFetchContext` exposes `userId`, `mediaService`, `preferenceEngine`, the request-scoped `dataloader`, and `logger`. Nothing below `MediaService` is accessible to a fetcher — plugin runtime, credentials, and DB are all out of reach.

The layout handler reuses `RowFetcher.fetch` for _both_ the inlined first page (inside `getLayout`) and scroll pagination (inside `getRowContent`). This is the entire reason the layout-plus-content split exists: one fetch implementation per row, called with a null cursor for initial and a real cursor for scroll.

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

No new capability files. No new database migrations. The only `MediaService` additions are thin count methods and one batched status method (§8).

## API surface

Two oRPC procedures under `server/api/routes/home.ts`, both authenticated-user-only (scope: `ctx.user.id`). No admin variants. Errors use `UserFacingError` from the error-management doc.

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
  rowId: RowKind;
  title: string; // "Continue Watching"
  subtitle?: string; // e.g. "Because you watched Inception" on seed rows
  kind: RowKind; // discriminator for client rendering
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

Called when the user scrolls a row horizontally past the inlined first page. Uses the same per-row fetcher as `getLayout`, not a separate code path.

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

Home-feed-specific shape. Overlaps with the MCP compact shape but adds dashboard-only fields (`backdrop`, `progress`) and keeps `episode` as an optional extension for `upcomingForYou`. Mapping from `MediaItem` lives in `server/home/compact.ts` — the single place this conversion happens.

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

Absent fields are omitted, not null. Same compression discipline as `ent_discover`.

### Error codes

New codes registered in `HOST_ERROR_CODES`:

| Code                   | When                                                                                                    | Captured? |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| `home.bad_input`       | Invalid `rowId`, malformed cursor, cursor/rowId mismatch                                                | No        |
| `home.row_unavailable` | `getRowContent` called for a row the user no longer qualifies for (e.g. connection removed mid-session) | No        |
| `home.internal`        | Thrown inside a handler; underlying error propagated for the admin viewer                               | Yes       |

Row-level partial failures (some plugins erroring during aggregate) are not errors — they surface as `partial: true` on the row. Full-row failure (zero items from all sources) is not an error either — it degrades to row-omit during `getLayout`, and returns `{ items: [], cursor: null }` during `getRowContent` so scroll behavior stays consistent.

## Layout decision logic

The layout endpoint has two concerns: _which rows exist_ and _in what order_. Both are pure functions over a signal snapshot. Content fetching is a separate concern, parallelized after the layout decision is made.

### Signal snapshot

`LayoutSignals` is populated by `signals.ts` via a parallel set of cheap reads. Target <50ms P95 for the whole snapshot.

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
    tmdbId: string;
    mediaType: "movie" | "tv";
    title: string; // resolved from metadata cache
    reason: "high_rating" | "liked" | "recently_completed";
  } | null;
}
```

**Per-signal sources:**

| Signal                  | Source                                                                                                                                                                                       | Cost         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `hasXPlugin`            | `service_connections` JOIN capability registry; per-user cached                                                                                                                              | cache read   |
| `inProgressCount`       | `MediaService.getInProgressCount(userId)` — thin read-through over watchHistory cache                                                                                                        | cache read   |
| `watchlistCount`        | `MediaService.getWatchlistCount(userId)` — same pattern                                                                                                                                      | cache read   |
| `calendarProgressCount` | Derived from in-progress set + at-least-one-future-episode check                                                                                                                             | cache read   |
| `profileConfidence`     | `preference_profiles.confidence` for media_type="combined"; `"none"` if row missing                                                                                                          | indexed read |
| `recentSeed`            | `feedback_log` LIMIT 1 WHERE `action IN ("like", "rate") AND (action != "rate" OR rating >= 8) AND created_at > now-30d`, indexed; fallback to most-recent-completed from watchHistory cache | indexed read |

The three new `MediaService` count methods (`getInProgressCount`, `getWatchlistCount`, `getCalendarProgressCount`) are thin read-through wrappers over data already cached at the capability layer. One method each, no new capability. Detailed in §8.

### Candidate row set

Starts from the full v1 catalog, filtered by plugin availability and cheap-signal gates:

```ts
function candidateRows(signals: LayoutSignals): RowKind[] {
  const out: RowKind[] = [];

  if (signals.hasWatchHistoryPlugin && signals.inProgressCount > 0) {
    out.push("continueWatching");
  }
  if (signals.hasRecommendationsPlugin || signals.profileConfidence !== "none") {
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

Applied after candidate filtering. Pure function, testable in isolation, swappable for A/B later.

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

After per-row fetches complete, drop any row whose `items` came back empty. Handles signal drift — cache said non-empty, fetch returned zero. One deliberate exception:

```ts
function dropEmpty(rows: FetchedRow[]): FetchedRow[] {
  return rows.filter((r) => r.items.length > 0 || r.rowId === "upcomingForYou");
}
```

`upcomingForYou` is exempt because "No upcoming episodes for your shows" is meaningful information a user was looking for; removing the row entirely would be more confusing than showing it empty.

### A/B hook

The entire layout decision reduces to:

```ts
function resolveLayoutOrder(signals: LayoutSignals): RowKind[] {
  return orderRows(candidateRows(signals), signals);
}
```

Everything upstream of fetch is pure. A variant is a different `resolveLayoutOrder`; experiment selection happens once in the layout handler and does not touch fetch code. No experiment infra shipped in v1, but the shape is built for it.

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

Hard per-row fetch timeout: 3s. A row that times out is treated as empty (row-drop applies).

## Row catalog

Each row is one file under `server/home/rows/` implementing `RowFetcher`. Summary table, then per-row notes where the details matter.

| Row                 | Capability & method                                     | Strategy          | Cursor       | First page | Max items | Extra fields            |
| ------------------- | ------------------------------------------------------- | ----------------- | ------------ | ---------- | --------- | ----------------------- |
| `continueWatching`  | `watchHistory@v1.getInProgress`                         | aggregate         | offset       | 20         | 100       | `progress`              |
| `recommendedForYou` | `recommendations@v1.get` → PreferenceEngine re-rank     | aggregate         | page+exclude | 20         | 60        | `matchReason`, `status` |
| `trendingNow`       | `recommendations@v1.getTrending`                        | aggregate         | page         | 20         | 60        | `status`                |
| `newReleases`       | `metadata@v1.discover` (recent-release filter)          | primary_with_enr. | page         | 20         | 60        | `status`                |
| `becauseYouWatched` | `metadata@v1.getSimilar` (seed from signals.recentSeed) | primary_with_enr. | page         | 20         | 40        | `matchReason`, `status` |
| `upcomingForYou`    | `calendar@v1.getUpcoming` (in-progress shows only)      | aggregate         | afterTmdbId  | 20         | 60        | `episode`               |
| `yourWatchlist`     | `watchlist@v1.list`                                     | aggregate         | offset       | 20         | 200       | `status`                |

Every row batches `status` via a single `mediaRequest@v1.getStatusBatch` call per page, coalesced across rows within a single request via the dataloader (§7).

### Per-row details

**`continueWatching`**

- `MediaService` method: `getInProgress(userId, { cursor, limit })` — a new `watchHistory@v1` method. Returns items with `watched_ms` / `duration_ms`. Plugins that don't implement it are skipped in aggregate (backward-compatible addition).
- Within-row dedupe by `(tmdbId, mediaType)`; most-recent-progress wins when two plugins report overlapping items.
- No PreferenceEngine re-rank. The in-progress list is not a discovery surface.
- Ordering: most-recently-watched first.

**`recommendedForYou`**

- Fetches `limit × 3` candidates per page (same over-fetch-then-prune as `ent_discover`), runs `PreferenceEngine.rankCandidates`, takes top `limit`, calls `explainMatch` only for the returned top-N.
- Empty case: if `recommendations@v1` has no connected plugins and profile confidence is `"none"`, the row is filtered out in candidate selection. If plugin exists but profile is thin, upstream results pass through with `matchReason` omitted; the row still renders.
- Pagination carries an exclusion list in the cursor (see §7) to prevent duplicates across scroll pages when ranking shifts between requests.

**`trendingNow`**

- No PreferenceEngine re-rank — this is the "everyone agrees this is popular" row on purpose. Keeps it distinct from `recommendedForYou`.
- `recommendations@v1.getTrending` is a backward-compatible method addition per the MCP spec.

**`newReleases`**

- `metadata@v1.discover` with fixed filters: `release_date.gte = now - 90d`, `release_date.lte = now`, sort by popularity desc.
- Mixes movies and TV in v1. A `media_type` filter is not exposed; if needed, a client-side filter on `CompactMediaItem.mediaType` or an opt-in endpoint parameter later.

**`becauseYouWatched`**

- Subtitle is dynamic: `"Because you watched ${signal.recentSeed.title}"`. The only row with a dynamic subtitle.
- Seed selection lives in `signals.ts`, not in this row's fetcher, because the same signal is consumed by candidate filtering in the layout layer.
- Seed can go stale mid-session (user rates something higher five minutes later). Acceptable — next `getLayout` picks up the new seed.
- TMDB `/similar` is paginated by `page`; trivial cursor.

**`upcomingForYou`**

- Subtitle is none at the row level; per-item `episode` field carries the detail.
- Scoped to shows the user currently has in progress (from the same cached in-progress set signals use).
- Cursor is `afterTmdbId` because aggregate results across calendar plugins don't have a stable page notion.
- Exempt from drop-empty (see §5 above).

**`yourWatchlist`**

- Sort: most-recently-added first. Overridable via a row-level preference later; not in v1.
- `maxItems: 200` — users with long watchlists expect them all reachable. Past 200, the UI should offer an explicit "go to watchlist" affordance (future frontend concern).

### Dedupe rules

- **Within-row:** dedupe by `(tmdbId, mediaType)` after aggregate merge. Always.
- **Within scroll pages:** the cursor's page / afterId / exclusion-list logic handles it per row.
- **Cross-row:** not deduped in v1. Accept "Inception" appearing in both Trending and New Releases. If this proves noisy, add a seen-set at the tail of the layout handler — cheap to retrofit; avoids designing against a problem we haven't observed.

## Caching, pagination, and request coordination

### Caching layers

Three layers, each with one job.

| Layer                      | Scope                                     | TTL                   | Purpose                                         |
| -------------------------- | ----------------------------------------- | --------------------- | ----------------------------------------------- |
| `MediaService` LRU / Redis | Global, per-capability                    | Per MediaService spec | Cross-request cache for capability call results |
| Request-scoped dataloader  | Single `getLayout` / `getRowContent` call | Request lifetime      | Cross-row dedupe within a single request        |
| PreferenceEngine profile   | Per user (existing)                       | Written at rebuild    | Score data; no new cache                        |

**No new home-feed-level cache in v1.** Per-row `MediaService` TTLs already handle most of the win; a layout-level cache would complicate invalidation on feedback events for a marginal improvement. Revisit if `getLayout` P95 shows up on flame graphs.

### Per-row TTLs

All inherited from the capability layer; none overridden.

| Row                 | Underlying capability | TTL                                            |
| ------------------- | --------------------- | ---------------------------------------------- |
| `continueWatching`  | `watchHistory@v1`     | 5 min                                          |
| `recommendedForYou` | `recommendations@v1`  | 6 h (candidates); re-rank runs fresh each call |
| `trendingNow`       | `recommendations@v1`  | 6 h                                            |
| `newReleases`       | `metadata@v1`         | 24 h                                           |
| `becauseYouWatched` | `metadata@v1`         | 24 h (keyed on seed id)                        |
| `upcomingForYou`    | `calendar@v1`         | 1 h                                            |
| `yourWatchlist`     | `watchlist@v1`        | 5 min                                          |

Important detail on `recommendedForYou`: the _candidate list_ is cached at 6 h, but `PreferenceEngine.rankCandidates` runs on every request. Profile changes (incremental update or daily rebuild) take effect on the next `getLayout` without touching the candidate cache. No invalidation plumbing needed between the PreferenceEngine and the home-feed layer.

### Request-scoped dataloader

Memoization keyed on `(method, argsHash)` with the userId implicit in the request scope. Lives for one `getLayout` or `getRowContent` call, then discarded. Fronts the `MediaService` methods where cross-row overlap is likely.

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

Two methods deserve special handling:

- **`getMetadata`** — straight memoization. Two rows needing the same title share one underlying call.
- **`getStatusBatch`** — microtask-level coalescing. Each row calls `loader.getStatusBatch(rowItems)` during its fetch; the loader collects all calls in the same microtask, unions the id set, fires one `mediaRequest@v1.getStatusBatch`, splits the response back out per caller.

Other `MediaService` methods are not wrapped by the dataloader — they have narrower cross-row overlap, and the `MediaService` LRU handles repeats at request granularity well enough.

### Cursor format

Opaque base64-encoded JSON, versioned. Three variants plus a combined page+exclusion variant for `recommendedForYou`.

```ts
// page-based (trendingNow, newReleases, becauseYouWatched)
{ v: 1, r: "trendingNow", p: 2 }

// offset-based (continueWatching, yourWatchlist)
{ v: 1, r: "yourWatchlist", o: 40 }

// afterTmdbId-based (upcomingForYou)
{ v: 1, r: "upcomingForYou", a: "tv:1396", ts: 1713820000000 }

// page + exclusion list (recommendedForYou only)
{ v: 1, r: "recommendedForYou", p: 2, x: ["movie:550", "tv:1396", ...] }
```

Validation on `getRowContent`:

- `v !== 1` → `home.bad_input`.
- Cursor's `r` doesn't match input `rowId` → `home.bad_input`.
- Required fields for the row's variant missing → `home.bad_input`.
- Cursor decodes to an offset/page beyond `maxItems` → `{ items: [], cursor: null }` (graceful stop, not an error).
- Cursor past end of underlying data → same graceful stop.

Cursors do not expire. If underlying data shifts between pages (new watchlist items added, rankings refresh), the user may see slight inconsistencies on scroll. Acceptable for a home feed; this discipline is deliberately row-local and not applied elsewhere in the system.

### `recommendedForYou` exclusion list

Re-ranking on every page creates a risk of duplicates across scroll pages: an item ranked 15 on page 1 may rank 21 on page 2 if the profile updated in between. The cursor carries the IDs returned on prior pages and the server excludes them before responding.

Bounds: exclusion list capped at `maxItems` (60). Cursor stays under ~2KB encoded. Only `recommendedForYou` uses this variant.

### Timeouts

- **Per-row fetch:** 3s hard cap. Passed into `MediaService` via the existing per-call timeout override. On timeout, row is treated as empty (drop-empty applies).
- **`getLayout` overall response:** bounded by the slowest row (≤3s) + minor overhead.
- **`getRowContent`:** 3s flat.

### Concurrency and fairness

A single `getLayout` fans out up to seven aggregate calls, each potentially hitting multiple plugins. Per-plugin rate-limit accounting (an open question in the MediaService doc) applies. No new concurrency primitive is introduced here. Worst-case hammering on install day for a user with many plugins is real but bounded by existing `MediaService` rate limits.

## Empty states and degradation

### User-state taxonomy

| State                                              | Rows that render                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No plugins, no shared creds**                    | `rows: []` — client renders an onboarding empty state                                                                                                    |
| **TMDB via shared admin key only** (day-zero)      | `newReleases` always; `becauseYouWatched` if feedback seed exists                                                                                        |
| **TMDB + feedback signal but no trackers**         | `newReleases`, `becauseYouWatched`, and `recommendedForYou` (thin profile → low-confidence re-rank) if a plugin implementing `recommendations@v1` exists |
| **TMDB + tracker (e.g. Trakt)**                    | All seven rows eligible, subject to per-row content checks                                                                                               |
| **Full install (TMDB + Trakt + Seerr + calendar)** | All seven rows                                                                                                                                           |

Each transition is driven by the signal computation and candidate filter in §5. Nothing special-cases "the user just connected X" — the next `getLayout` simply picks it up.

### Empty layout

When `rows` is empty after filtering and drop-empty, return:

```json
{ "rows": [], "generatedAt": 1713820000000 }
```

The client is responsible for the empty-state UX. It already knows the user's connection state via the existing `/connections` oRPC surface and has everything it needs to render context-appropriate guidance. No `guidance` field on the layout response — avoids duplicating knowledge that lives in the connections layer.

### Degradation matrix

| Failure mode                                         | Row behavior                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Required capability has zero connected plugins       | Row filtered out in candidate selection (pre-fetch)                  |
| Cheap-signal count is zero                           | Row filtered out in candidate selection                              |
| Aggregate with partial plugin failure                | Row renders with returned data + `partial: true`                     |
| Aggregate with all plugins failing                   | Row empty; drop-empty removes it (exception: `upcomingForYou`)       |
| Primary-with-enrichment primary fails                | Row empty; dropped                                                   |
| `becauseYouWatched` seed doesn't resolve in metadata | Row dropped; signal clears seed for subsequent calls                 |
| Per-row 3s timeout exceeded                          | Row treated as empty; dropped                                        |
| `PreferenceEngine.explainMatch` fails for an item    | `matchReason` omitted on that item; row otherwise unaffected         |
| `PreferenceEngine.rankCandidates` fails              | Fall back to upstream aggregate order; log; row still renders        |
| Signal computation partial failure                   | Failing signal defaults (0 / `"none"`); log; layout proceeds         |
| Signal computation total failure (DB down)           | `getLayout` throws `home.internal` (captured)                        |
| `mediaRequest@v1.getStatusBatch` fails               | `status` omitted on items; rows otherwise unaffected                 |
| `PreferenceEngine` entirely unavailable              | `recommendedForYou` renders via upstream order; `matchReason` absent |

Principle throughout: **degrade silently at the row level, fail loudly at the infra level.** A plugin being down is product behavior; the DB being down is an incident.

### `partial: true` signaling

Set on a row when `MediaService` returned aggregate errors alongside data. The client uses it as a signal to render a subtle affordance ("some sources unavailable") and deep-link to `/connections` where the real error detail lives via the connection's `status` field. The home feed does not surface specific error messages — that's the Connections page's job per the error-management doc.

Not promoted to a top-level response field; keeping the signal on the row preserves locality.

### Plugin-connection changes during a session

When the user enables, disables, or removes a connection via `/connections`, subsequent `getLayout` calls reflect the new state (signals recompute, rows filter accordingly). Stale `getRowContent` cursors for a row that has since been dropped produce `home.row_unavailable`, which the client treats as "stop paginating, the row is gone." Consistent with the connection-change cache-invalidation hook from the `MediaService` doc.

### Feedback events during a session

`ent_feedback` writes to `feedback_log` and triggers the `PreferenceEngine` incremental-update job. The home feed does not self-invalidate:

- The candidate-list cache in `MediaService` is untouched by feedback — it's the upstream plugins' aggregation, not user-specific.
- The profile used by `rankCandidates` refreshes as soon as the incremental job runs (coalesced, ~30s debounce). Next `getLayout` picks it up.
- `recentSeed` for `becauseYouWatched` updates on the next `getLayout`.

Small window (up to ~30 seconds) where a user gives feedback and the next home load still shows the old ranking. Acceptable — matches the preview-vs-authoritative pattern from the PreferenceEngine spec.

### First-visit / cold-cache behavior

First-ever `getLayout` for a user warms all per-row caches. Rough P95 upper bound: 3s (timeout cap). Subsequent visits within TTL: ~100–500ms depending on how many rows still need revalidation.

No "show skeleton, reload later" logic in v1 — a row is either returned or not. If cold-cache latency proves painful, a warm-on-connection-create hook is a small addition; deferred.

## `MediaService` and capability additions

All additions are backward-compatible. Plugins that don't implement a new capability method are skipped in aggregate per existing MediaService semantics.

### New `MediaService` methods

Thin read-throughs; no new capability.

- `getInProgressCount(userId): Promise<number>` — count of items returned by `watchHistory@v1.getInProgress`, served from the capability cache.
- `getWatchlistCount(userId): Promise<number>` — count of items returned by `watchlist@v1.list`, served from the capability cache.
- `getCalendarProgressCount(userId): Promise<number>` — count of in-progress shows with at least one future episode, derived from the watchHistory in-progress set cross-referenced with calendar data.

### New capability methods

- `watchHistory@v1.getInProgress(userId, { cursor, limit })` — returns in-progress items with `watched_ms` and `duration_ms`. Backward-compatible addition.
- `mediaRequest@v1.getStatusBatch(userId, ids: MediaId[])` — batched variant of `getStatus` returning `Record<tmdbId, status>`. Plugins that don't implement it are skipped; status falls back to `"unknown"` for items from non-implementing plugins.

### Pre-existing but referenced

These are already spec'd (MCP doc or `ent_discover`'s discover/trending additions):

- `recommendations@v1.getTrending({ mediaType?, limit, cursor })`
- `metadata@v1.discover({ filters, sort, limit, cursor })`

## Testing

One test file per unit. Favor small, fast unit tests over integration tests; one end-to-end path per user-state fixture.

### Signal computation (`signals.test.ts`)

- Each signal independently: given a fixture DB state + mocked `MediaService`, the signal returns the expected value.
- Partial failures: one signal source errors → the signal defaults and others complete normally.
- Total DB failure: snapshot throws; caller propagates as `home.internal`.
- `recentSeed` fallback chain: high-rating → like → recently-completed → null.

### Layout rules (`rules.test.ts`)

Pure-function tests, no mocks.

- `candidateRows(signals)` for representative signal snapshots (zero-plugin, TMDB-only, full-install).
- `orderRows(candidates, signals)` across the confidence matrix (none/low/medium/high), verifying the RFY ↔ Trending swap.
- Static tail ordering: `yourWatchlist`, `newReleases`, `upcomingForYou` always appear in that relative order.
- Snapshot test on the full (signal snapshot → expected row order) table for the v1 rule set.

### Row-fetcher contract tests

One file per row under `rows/*.test.ts`. Every row exercises:

- Happy path: fixture plugin returns data → row returns `CompactMediaItem[]` in the right shape.
- Within-row dedupe: overlapping items from two plugins → single entry (most-recent-progress wins where applicable).
- Cursor roundtrip: `fetch(null)` → `cursor X` → `fetch(X)` → `cursor Y` → eventually null.
- Max-items cap: pagination stops at the declared `maxItems`.
- Per-row timeout: slow plugin → returns `{ items: [], cursor: null }`.
- Partial aggregate: one failing + one succeeding plugin → merged data with `partial: true`.

Row-specific additions:

- `continueWatching`: `progress` populated; items without progress excluded; sorted most-recent-watched-at first.
- `recommendedForYou`: candidate over-fetch = limit × 3; `rankCandidates` called once; `explainMatch` called only for returned top-N; thin profile → `matchReason` omitted, row still renders.
- `becauseYouWatched`: subtitle contains seed title; seed resolution failure → row drops cleanly.
- `recommendedForYou` exclusion: page 2 cursor carries ~20 IDs from page 1; page 2 excludes them; exclusion list capped at `maxItems`.

### Dataloader (`dataloader.test.ts`)

- Same `getMetadata(id)` called twice within one request → one underlying call.
- `getStatusBatch` coalescing: three rows each call with disjoint ID sets → one combined upstream call → correct per-caller split.
- Error propagation: underlying call fails → all awaiting callers receive the same error.
- Non-dataloader methods are not memoized.

### Cursor (`cursor.test.ts`)

- Encode/decode roundtrip for each variant (page, offset, afterTmdbId, page+exclusion).
- Malformed base64 → `home.bad_input`.
- Version mismatch → `home.bad_input`.
- `rowId` mismatch → `home.bad_input`.
- Exclusion list size cap enforced on encode.

### `HomeFeedService` integration tests

One test per user-state fixture:

- **No plugins:** `getLayout` → `rows: []`.
- **Shared TMDB only:** `getLayout` → `newReleases` only.
- **TMDB + feedback signal, no trackers:** `newReleases` + `becauseYouWatched` + `recommendedForYou` (thin).
- **TMDB + Trakt:** full eligible set with correct ordering per profile confidence.
- **Full install mid-rebuild:** reads current profile; ranking reflects stale-but-valid profile; no error.

Each fixture asserts the row set, order, and which rows carry `matchReason` / `progress` / `partial`.

### API contract tests

- oRPC input schema: `getLayout` rejects extra keys (strict); `getRowContent` requires `rowId` and `cursor`; unknown `rowId` → `home.bad_input`.
- oRPC output schema matches the published type in `@ent-mcp/shared`; no extraneous fields.
- Shape stability: snapshot test on a canonical fixture response.

### Degradation integration

- Each capability's aggregate with one plugin failing → `partial: true` on corresponding row.
- All plugins for a capability fail → row dropped (except `upcomingForYou`).
- `upcomingForYou` empty → row retained with `items: []`.
- `getRowContent` for a row that became unavailable between layout calls → `home.row_unavailable`.
- Cursor past end of data → `{ items: [], cursor: null }`, not an error.

### Not tested here

- `MediaService` behavior under partial failures — MediaService suite.
- `PreferenceEngine` ranking correctness — PreferenceEngine suite.
- Plugin runtime sandboxing — plugin-runtime suite.
- Job-service coalescing of incremental updates — job-service suite.

## Open questions / deferred

- **Billboard hero unit.** Additive `layout.hero` field. Reserved for a later spec.
- **Cross-row dedupe.** Not applied in v1. If "same title in Trending and New Releases" feels noisy in practice, add a seen-set at the tail of the layout handler.
- **Personalized row ordering beyond the rule table.** Requires engagement tracking ruled out by the PreferenceEngine spec.
- **Genre-scoped rows.** Defer until `preference_profiles` data is strong enough to pick well.
- **Streaming / progressive loading.** Synchronous response in v1. If a slow row becomes a P95 problem, per-row SSE is a clean retrofit — the `RowFetcher` shape is already row-local.
- **Layout-level caching per user.** Not worth it until per-row TTLs prove insufficient.
- **Cache pre-warm on connection-create.** First `getLayout` after connecting warms the cache cold. Add a hook if the cold-load UX is visibly bad.
- **Dashboard rate limiting.** Not introduced here. If needed, extend the same token-bucket primitive used for MCP to oRPC.
- **A/B variants on the rule table.** The pure-function shape is built for it; no experiment infra wired in v1.
- **MCP equivalent.** MCP agents already get home-page-equivalent data via `ent_discover`; a dedicated `ent_home` tool would duplicate that surface and is not planned.

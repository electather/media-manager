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

`RowFetchContext` is the sole surface a row fetcher sees. Nothing below `MediaService` is accessible to a fetcher — plugin runtime, credentials, and DB are all out of reach.

`isEligible` is called only from `getRowContent` (not `getLayout`, which uses the signal snapshot) and must be cheap — the per-row checks specified in §8 all resolve off already-cached data and target sub-5ms. Declaring it as a required interface member (rather than optional) means every new row must state its eligibility rule explicitly, and TypeScript will refuse a fetcher that forgot to implement it. A row that really is always eligible (see `newReleases` in §8) returns `true` unconditionally.

The `requires` field is declarative — intended for future auto-documentation and generic registry use. The authoritative runtime gate for whether a row appears in a layout is `candidateRows` in `rules.ts` (§5). If a new row is added, both must be kept in sync: `requires` lists its capability dependencies for humans and tooling, `candidateRows` contains the live check that actually filters it. When they disagree, `candidateRows` wins at runtime; a lint/test checking that every `RowFetcher.requires` entry corresponds to a gate in `candidateRows` is a small retrofit if drift proves real.

The layout handler reuses `RowFetcher.fetch` for _both_ the inlined first page (inside `getLayout`) and scroll pagination (inside `getRowContent`). This is the entire reason the layout-plus-content split exists: one fetch implementation per row, called with either a null cursor (most rows) or a synthetic initial cursor (see below) for the first page and a real client-supplied cursor for scroll.

For rows whose first page already needs out-of-band state — currently just `becauseYouWatched`, whose seed lives in `LayoutSignals` and must be pinned for the scroll session — the layout handler constructs an initial cursor that carries that state before calling `fetch`. Concretely, `becauseYouWatched` receives `{ v: 1, r: "becauseYouWatched", p: 1, s: signals.recentSeed.id }` as `opts.cursor` rather than `null`. The fetcher therefore always reads the seed from the cursor: it never consults `signals.recentSeed` directly, and never branches on "cursor is null → this is page 1 → look up seed somewhere else." `RowFetchContext` deliberately does not expose the signal snapshot, and this convention preserves that — seed state is threaded in through the cursor, the same mechanism scroll pages already use. Other rows continue to receive `null` on the first page and unchanged client cursors on subsequent pages.

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

**Shared types live in `@ent-mcp/shared/home`.** Per the repo's shared-package rules (`CLAUDE.md`), any type that crosses the server/client boundary must live in `packages/shared/src/home/` and be exported via the subpath export in `packages/shared/package.json`. The types that qualify: `RowKind` (const tuple + derived type, per shared package conventions), `HomeRow`, `HomeLayoutResponse`, `RowContentResponse`, and `CompactMediaItem`. The `FetchedRow` / `FetchOutcome` types (§5) are host-internal and stay in `server/home/`. Zod schemas for cursor validation also stay server-internal (cursors are opaque on the wire; the client never decodes them).

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

| Signal                  | Source                                                                                                                                                                                                                                                              | Cost         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `hasXPlugin`            | `service_connections` JOIN capability registry; per-user cached                                                                                                                                                                                                     | cache read   |
| `inProgressCount`       | `MediaService.getInProgressCount(userId)` — thin read-through over watchHistory cache                                                                                                                                                                               | cache read   |
| `watchlistCount`        | `MediaService.getWatchlistCount(userId)` — same pattern                                                                                                                                                                                                             | cache read   |
| `calendarProgressCount` | Derived from in-progress set + at-least-one-future-episode check (see "Calendar cold-cache" below)                                                                                                                                                                  | cache read   |
| `profileConfidence`     | `preference_profiles.confidence` for media_type="combined"; `"none"` if row missing                                                                                                                                                                                 | indexed read |
| `recentSeed`            | `feedback_log` `ORDER BY created_at DESC LIMIT 1` WHERE `action IN ("like", "rate") AND (action != "rate" OR rating >= 8) AND created_at > now-30d`, indexed; fallback to most-recent-completed-within-60d from watchHistory (see "Recency window asymmetry" below) | indexed read |

The three new `MediaService` count methods (`getInProgressCount`, `getWatchlistCount`, `getCalendarProgressCount`) are thin read-through wrappers over data already cached at the capability layer. One method each, no new capability. Detailed in §8.

**Recency window asymmetry.** The primary path uses a 30d window; the fallback uses 60d. Intentional. A `like` or high `rate` is an active, volitional signal — recent feedback is strong, older feedback is stale fast, so the window is tight. A completed watch is a passive signal — much weaker per-event, so the window is wider to accumulate enough evidence that an item is worth seeding off. Narrowing the fallback to match the primary would leave users without recent explicit feedback with no seed at all, which defeats the point of the fallback.

**Calendar cold-cache.** `calendarProgressCount` is "cache read" only when the calendar data is warm. Calendar's TTL is 1h versus watchHistory's 5min, so the calendar cache is the more likely cold one. If `getCalendarProgressCount` would have to trigger a live aggregate fetch to satisfy the derivation, the signal returns `0` instead and logs. This drops `upcomingForYou` from the current layout; it reappears on the next `getLayout` once the calendar cache warms (via either the normal calendar refresh cycle or another row's fetch). Preserves the <50ms signal-snapshot budget at the cost of one potentially-missed row on the very first cold call after a calendar TTL expiry.

### Candidate row set

Starts from the full v1 catalog, filtered by plugin availability and cheap-signal gates:

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

`FetchedRow` is the layout orchestrator's internal shape, assembled from each `RowFetcher.fetch` return plus the orchestrator's own knowledge of what happened (did the call complete within the timeout, did all plugins fail, etc.). The orchestrator then strips `outcome` when mapping to the wire-level `HomeRow` — clients only see `items`, `cursor`, and `partial`. `outcome` is a host-internal discriminant used for drop-empty logic and for observability/logging.

**`FetchOutcome` assignment.** `RowFetcher.fetch` returns `{ items, cursor, partial? }` or throws; it does not know whether it has timed out, been cancelled, or had all its upstream plugins fail. The orchestrator wraps every fetch dispatch and maps it to an outcome:

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
    // Aggregate fetchers surface AllPluginsFailedError from MediaService when every
    // contributing plugin errored; anything else is an orchestrator-level fault.
    if (err instanceof AllPluginsFailedError) {
      return { ...empty(fetcher), outcome: "all_failed" };
    }
    throw err; // bubbles to home.internal
  }
}
```

In short: `ok_items` / `ok_empty` / `partial` come from the shape of the successful return; `timeout` comes from the 3s `Promise.race`; `all_failed` comes from a specific `MediaService` aggregate error distinguishable from other throws. This is the only place `FetchOutcome` values are assigned — row fetchers themselves never see or set the field.

`upcomingForYou` is exempt **only when the fetch succeeded and genuinely returned zero items** (`outcome === "ok_empty"`) — "No upcoming episodes for your shows" is meaningful information the user was looking for. When the row timed out or all calendar plugins errored, we drop the row like any other: an empty timeout-row carries a different semantic ("no data available right now") than a genuine empty ("you're caught up"), and rendering the "caught up" copy for a plugin outage is wrong.

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
| `becauseYouWatched` | `metadata@v1.getSimilar` (seed from signals.recentSeed) | primary_with_enr. | page+seed    | 20         | 40        | `matchReason`, `status` |
| `upcomingForYou`    | `calendar@v1.getUpcoming` (in-progress shows only)      | aggregate         | afterTmdbId  | 20         | 60        | `episode`               |
| `yourWatchlist`     | `watchlist@v1.list`                                     | aggregate         | offset       | 20         | 200       | `status`                |

Every row batches `status` via a single `mediaRequest@v1.getStatusBatch` call per page, coalesced across rows within a single request via the dataloader (§7).

### Per-row details

**`continueWatching`**

- `MediaService` method: `getInProgress(userId, { cursor, limit })` — a new `watchHistory@v1` method. Returns items with `watched_ms` / `duration_ms`. Plugins that don't implement it are skipped in aggregate (backward-compatible addition).
- Within-row dedupe by `(tmdbId, mediaType)`; most-recent-progress wins when two plugins report overlapping items.
- No PreferenceEngine re-rank. The in-progress list is not a discovery surface.
- Ordering: most-recently-watched first.
- `progress` field handling: the fetcher omits `progress` entirely on items where `duration_ms` is missing, zero, or negative. Protects the client from divide-by-zero on live content, specials, or shorts where the plugin couldn't supply a runtime. Items without `progress` are still included in the row — they're genuinely in-progress from the plugin's perspective; we just don't have a renderable percentage. Server-client contract: absent `progress` means "in-progress item, progress unmeasurable." Rendering (progress bar vs. generic play affordance) is the frontend spec's concern; this spec only guarantees the field is absent rather than `{ watched: 0, total: 0 }` or NaN.

**`recommendedForYou`**

- Fetches `limit × 3` candidates per page (same over-fetch-then-prune as `ent_discover`), runs `PreferenceEngine.rankCandidates`, takes top `limit`, calls `explainMatch` only for the returned top-N.
- Empty case: the row requires at least one connected `recommendations@v1` plugin — a "has feedback, no plugin" state would produce an empty row every time, so it's filtered out in candidate selection rather than admitted and silently dropped. If plugin exists but profile is thin, upstream results pass through with `matchReason` omitted; the row still renders. A profile-only fallback (e.g. TMDB trending re-ranked by PreferenceEngine) is out of scope for v1 — if we want to light this row up for profile-only users later, it's a new row strategy, not a tweak to this one.
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
- Seed can go stale between two `getLayout` calls (user rates something higher five minutes later). Next `getLayout` picks up the new seed.
- The seed is threaded into the fetcher **through the cursor, not through a side channel**. For the inlined first page, the layout handler synthesises an initial cursor — `{ v: 1, r: "becauseYouWatched", p: 1, s: signals.recentSeed.id }` — and passes it as `opts.cursor` instead of `null`. For scroll pages, the client echoes back the `s` value it received on the previous page. Either way the fetcher reads the seed from exactly one place (`cursor.s`), never from `LayoutSignals` (which is not on `RowFetchContext`) and never with a "cursor is null → page 1 → look seed up somewhere" branch. This keeps the fetcher's input surface uniform across `getLayout` and `getRowContent`, and makes the test matrix in §11 straightforward (no special "page 1 without cursor" code path to exercise).
- Within a single scroll session, the seed is therefore **pinned** via the cursor's `s` field (§7). `getRowContent` reads `s` and calls `metadata@v1.getSimilar(seed, { page })` against that specific seed, ignoring any live `signals.recentSeed` drift. Prevents page 2 from silently returning "similar to a different movie" than page 1.
- TMDB `/similar` is paginated by `page`; trivial cursor.
- Cross-row exclusion: the fetcher excludes any item whose `(tmdbId, mediaType)` is in the user's current in-progress set. `RowFetchContext` does not expose the signal snapshot to fetchers, so both page 1 (inside `getLayout`) and scroll pages (`getRowContent`) obtain the set via `ctx.dataloader.getInProgressSet()` — a dataloader-memoized read-through over `mediaService.getInProgress(userId)` that returns a `Set<MediaId>`. On page 1 this hits warm memoization because signal computation already called the same method during `LayoutSignals`; on scroll pages it hits the same watchHistory cache the signal used (sub-5ms when warm; <100ms cold). The exclusion applies on every page so scroll behavior matches page 1. Recommending something the user is actively watching is jarring — "Because you watched Inception: Inception" is the degenerate case, but "Because you watched Inception: The Matrix (which you're also 40% through)" is the real one this rule catches. Trending + New Releases overlap is deliberately not filtered — same content in different editorial contexts is acceptable; in-progress-in-a-discovery-row is not.

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

Four methods deserve special handling:

- **`getMetadata`** — straight memoization. Two rows needing the same title share one underlying call.
- **`getStatusBatch`** — microtask-level coalescing. Each row calls `loader.getStatusBatch(rowItems)` during its fetch; the loader collects all calls that arrive in the _same microtask_ and flushes on the next one (specifically via `queueMicrotask()`, same primitive the `dataloader` npm package uses). It unions the id set, fires one `mediaRequest@v1.getStatusBatch`, and splits the response back out per caller. Flushing on microtask (rather than `setImmediate` / `setTimeout(0)`) keeps coalescing latency inside sub-millisecond territory and avoids introducing a deferral large enough to be observable in row timings.
- **`getInProgressSet`** — memoized read-through over `mediaService.getInProgress(this.userId)` that returns a `Set<MediaId>`. Consumer is `becauseYouWatched` for cross-row exclusion on every page (both `getLayout` and `getRowContent`); signal computation also calls this method during `getLayout` to populate `inProgressCount` and `calendarProgressCount`, so page 1 hits a warm memoization when the fetcher calls through the loader. Single source of truth for the per-request in-progress set.
- **`hasPlugin(capability)`** — memoized lookup over `service_connections ∩ capability registry` for `this.userId`. Consumed by every `RowFetcher.isEligible` that needs to verify a plugin is still connected mid-session (six of seven rows; §8). The same table backs signal computation's `hasXPlugin` booleans, so the lookup hits the per-user plugin-presence cache rather than firing new DB queries. Memoization means two rows that both need the same capability only pay for one read.

**Status call timeout budget.** The coalesced `getStatusBatch` call has its own 1s cap (tighter than the 3s per-row cap, since status is an enrichment and rows should not sacrifice their entire budget to it). On timeout or full failure, all items in the caller rows have `status` omitted. `partial: true` is _not_ set for this case — status is not core row content, and the feed already tolerates `status === undefined` via the "unknown" fallback path in the frontend. Genuine aggregate partial failures from the underlying `mediaRequest@v1.getStatusBatch` (some plugins erroring while others return data) still surface status for items where at least one plugin responded.

Other `MediaService` methods are not wrapped by the dataloader — they have narrower cross-row overlap, and the `MediaService` LRU handles repeats at request granularity well enough.

### Cursor format

Opaque base64-encoded JSON, versioned. Four variants — page-based, offset-based, afterTmdbId-based, and two specialized page variants for `recommendedForYou` (with exclusion list) and `becauseYouWatched` (with pinned seed).

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

**`upcomingForYou` `ts` field.** An item in `upcomingForYou` represents one upcoming _episode_ of an in-progress show. Multiple upcoming episodes of the same show share `tmdbId` but differ in `airsAt`. `ts` carries the `airsAt` of the last returned item in the previous page; server pagination uses `(tmdbId, airsAt) > (cursor.a, cursor.ts)` as the composite ordering key for the next page. Without `ts`, a show with four upcoming episodes would either return duplicates across pages or skip episodes.

**`becauseYouWatched` `s` field.** The row is seed-dependent, and the seed is delivered to the fetcher exclusively through the cursor — including on page 1. During `getLayout`, the layout handler synthesises an initial cursor `{ v: 1, r: "becauseYouWatched", p: 1, s: signals.recentSeed.id }` and passes it as `opts.cursor` to `RowFetcher.fetch` in place of `null`. The fetcher therefore has a single code path: decode the cursor, read `s`, call `metadata@v1.getSimilar(seed, { page: cursor.p })`. There is no "cursor is null → page 1 → pull seed from some other context" branch, and `RowFetchContext` does not need to expose `LayoutSignals` to fetchers to make this work. The seed can shift mid-session (user rates something higher between page 1 and a scroll-to-page-2), so pagination must keep the same seed — otherwise `getRowContent` would silently return "similar to a different movie" with no error, and the user sees a broken scroll. `s` carries the media id (`"movie:550"` or `"tv:1396"`) and is echoed unchanged on every scroll page; `getRowContent` reads `s`, decodes it to `(tmdbId, mediaType)`, and uses that specific seed even if `signals.recentSeed` has since moved on. The row subtitle on the client stays stable for the scroll session; the new seed surfaces on the next `getLayout`. The same `s` is what `isEligible` resolves against in §8 ("does this specific seed still fetch" rather than "does the user still have any recent seed").

### Cursor validation

Cursors are untrusted client input. Every decode runs a Zod schema _before any business logic touches the payload_. The schema enforces:

- `v === 1`.
- `r` is one of the `RowKind` enum values.
- Variant-appropriate fields present and typed: `p` is a non-negative integer capped at `maxItems / pageSize`; `o` is a non-negative integer capped at `maxItems`; `a` and `s` match the `movie:NNN` / `tv:NNN` media-id pattern; `ts` is a positive integer ms epoch; `x` is a string array with `items <= maxItems` (60) and each entry matching the media-id pattern.
- No extra keys (strict parsing).

Decode outcomes:

| Outcome                                                     | Result                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Malformed base64 / non-JSON / fails Zod validation          | `home.bad_input`                                            |
| Cursor's `r` doesn't match the `rowId` in the request input | `home.bad_input`                                            |
| Decoded page/offset lies beyond `maxItems`                  | `{ items: [], cursor: null }` — graceful stop, not an error |
| Decoded position is past the end of underlying data         | same graceful stop                                          |

The decode-side cap on `x[]` and `p`/`o` is load-bearing: a crafted cursor with 10k entries in `x` would otherwise push the row fetcher into an O(candidates × 10k) filter. Zod rejects the payload before any allocation or dispatch happens.

Cursors do not expire and are **not HMAC-signed**. The risk analysis behind that choice:

- The oRPC endpoint authenticates the request via session; `userId` comes from `ctx.user.id`, never from the cursor. A client cannot paginate against another user's data by replaying a captured cursor — they'd need that user's session token, at which point the cursor is the least of the concerns.
- What a client _can_ do is craft arbitrary valid cursors for their own account. The worst this achieves within the validated payload shape is "skip to page 3 without fetching page 1" or "exclude titles I never saw" — both of which only affect the user's own view and give no access they don't already have via normal pagination.
- The real threat from untrusted cursor input is decode-time DoS (crash on malformed input, memory pressure from oversized payloads). Zod validation + hard length caps handle that directly.
- HMAC signing would add secret management, rotation, and per-request CPU cost to solve an attack the session-auth boundary already prevents. It's been considered and deliberately not adopted.

If the threat model changes later (e.g. cursor gets used as a capability token in a different surface), signing is a mechanical retrofit — encode becomes `base64(payload || hmac(secret, payload))`, decode verifies first. No cursor-shape change.

Cursor semantics note: cursors are best-effort across data shifts. If the watchlist changes between pages, the user may see slight inconsistencies on scroll. Acceptable for a home feed; this discipline is deliberately row-local and not applied elsewhere in the system.

### `recommendedForYou` exclusion list

Re-ranking on every page creates a risk of duplicates across scroll pages: an item ranked 15 on page 1 may rank 21 on page 2 if the profile updated in between. The cursor carries the IDs returned on prior pages and the server excludes them before responding.

Bounds: exclusion list capped at `maxItems` (60), enforced on **both encode and decode** per the cursor-validation schema above. Cursor stays under ~2KB encoded. Only `recommendedForYou` uses this variant.

### Timeouts

- **Per-row fetch:** 3s hard cap. Passed into `MediaService` via the existing per-call timeout override. On timeout, row is treated as empty (drop-empty applies).
- **`getLayout` overall response:** bounded by the slowest row (≤3s) + minor overhead.
- **`getRowContent`:** 3s flat. On timeout the endpoint returns `{ items: [], cursor: null }` — the same graceful end-of-pagination shape used for "decoded position past end of data" (§7 cursor validation) and "all plugins errored" (§9 degradation matrix). Consistency matters here: the client treats `cursor: null` uniformly as "stop paginating," so a timeout mid-scroll surfaces as the same end-of-row state rather than a thrown error. A timeout is logged so it shows up in observability, but is not promoted to `home.internal` — the row is a degradation surface, not an incident surface.

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

| Failure mode                                           | Row behavior                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Required capability has zero connected plugins         | Row filtered out in candidate selection (pre-fetch)                                                                             |
| Cheap-signal count is zero                             | Row filtered out in candidate selection                                                                                         |
| Aggregate with partial plugin failure                  | Row renders with returned data + `partial: true`                                                                                |
| Aggregate with all plugins failing                     | Row empty; drop-empty removes it (including `upcomingForYou` — see below)                                                       |
| Aggregate returning zero items (all plugins succeeded) | Row dropped by drop-empty, **except** `upcomingForYou` which is retained with `items: []` (meaningful "you're caught up" state) |
| Primary-with-enrichment primary fails                  | Row empty; dropped                                                                                                              |
| `becauseYouWatched` seed doesn't resolve in metadata   | Row dropped; signal clears seed for subsequent calls                                                                            |
| Per-row 3s timeout exceeded                            | Row treated as empty; dropped                                                                                                   |
| `PreferenceEngine.explainMatch` fails for an item      | `matchReason` omitted on that item; row otherwise unaffected                                                                    |
| `PreferenceEngine.rankCandidates` fails                | Fall back to upstream aggregate order; log; row still renders                                                                   |
| Signal computation partial failure                     | Failing signal defaults (0 / `"none"`); log; layout proceeds                                                                    |
| Signal computation total failure (DB down)             | `getLayout` throws `home.internal` (captured)                                                                                   |
| `mediaRequest@v1.getStatusBatch` fails                 | `status` omitted on items; rows otherwise unaffected                                                                            |
| `PreferenceEngine` entirely unavailable                | `recommendedForYou` renders via upstream order; `matchReason` absent                                                            |

Principle throughout: **degrade silently at the row level, fail loudly at the infra level.** A plugin being down is product behavior; the DB being down is an incident.

### `partial: true` signaling

Set on a row when `MediaService` returned aggregate errors alongside data. The client uses it as a signal to render a subtle affordance ("some sources unavailable") and deep-link to `/connections` where the real error detail lives via the connection's `status` field. The home feed does not surface specific error messages — that's the Connections page's job per the error-management doc.

Not promoted to a top-level response field; keeping the signal on the row preserves locality.

### Plugin-connection changes during a session

When the user enables, disables, or removes a connection via `/connections`, subsequent `getLayout` calls reflect the new state (signals recompute, rows filter accordingly). Stale `getRowContent` cursors for a row that has since been dropped produce `home.row_unavailable`, which the client treats as "stop paginating, the row is gone." Consistent with the connection-change cache-invalidation hook from the `MediaService` doc.

**Eligibility re-check on `getRowContent`.** We do **not** re-run the full `LayoutSignals` snapshot on every pagination call — a ~50ms snapshot on a horizontal-scroll request is wasted work. Instead, each `RowFetcher` declares a cheap `isEligible(userId, loader)` check using only what that row needs:

- `continueWatching` — `loader.hasPlugin("watchHistory@v1")`.
- `yourWatchlist` — `loader.hasPlugin("watchlist@v1")`.
- `upcomingForYou` — `loader.hasPlugin("calendar@v1")`.
- `recommendedForYou`, `trendingNow` — `loader.hasPlugin("recommendations@v1")`. `candidateRows` gates RFY strictly on plugin presence (profile-only fallback is out of scope for v1 per §6), so `isEligible` mirrors that — no profile-exists escape hatch.
- `becauseYouWatched` — verify the seed media id carried in the cursor's `s` field still resolves via `metadata@v1.getById`. Uses the cursor-pinned seed, not the live `signals.recentSeed` — pagination must be consistent with page 1 even when the user's recent seed has shifted.
- `newReleases` — always eligible; returns `true` unconditionally. `metadata@v1` is assumed present; if it's somehow not, the row fetch itself empties and the call returns `{ items: [], cursor: null }` rather than `home.row_unavailable`.

All `hasPlugin` calls go through `RequestScopedLoader.hasPlugin` (§7), which reads the same `service_connections` ∩ capability registry table signals use and memoizes per request — sub-5ms, and two rows checking the same capability only pay once. The `isEligible` contract is one method per row; implementations sit in each row fetcher file.

A failed eligibility check produces `home.row_unavailable` immediately, without touching the plugin runtime. A cursor that decodes but points past data (normal end-of-pagination) still returns `{ items: [], cursor: null }` — eligibility is about "is this row still legal for this user," not "is there more content."

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
- `mediaRequest@v1.getStatusBatch(userId, ids: MediaId[])` — batched variant of `getStatus` returning `Record<MediaId, status>` keyed on the same `MediaId` strings (`"movie:550"`, `"tv:1396"`) passed in `ids` — not on bare `tmdbId` integers. Keeping the keyspace symmetric with the input avoids a subtle split bug in the dataloader when it fans a coalesced response back to per-row callers. Plugins that don't implement it are skipped; status falls back to `"unknown"` for items from non-implementing plugins.

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

- `continueWatching`: `progress` populated when `duration_ms > 0`; items with missing/zero/negative `duration_ms` are **included** with the `progress` field absent (matches §6 contract); item with `duration_ms = 0` → returned, `progress` key absent on the item; sorted most-recent-watched-at first.
- `recommendedForYou`: candidate over-fetch = limit × 3; `rankCandidates` called once; `explainMatch` called only for returned top-N; thin profile → `matchReason` omitted, row still renders.
- `becauseYouWatched`: subtitle contains seed title; seed resolution failure on `getLayout` → row drops cleanly; `isEligible` called with a cursor whose pinned `s` no longer resolves via `metadata@v1.getById` → returns `false` (orchestrator then emits `home.row_unavailable`); `isEligible` with a still-resolvable `s` → returns `true` even when `signals.recentSeed` has shifted to a different title since page 1 (pagination stays pinned to the original seed).
- `recommendedForYou` exclusion: page 2 cursor carries ~20 IDs from page 1; page 2 excludes them; exclusion list capped at `maxItems`.

### Dataloader (`dataloader.test.ts`)

- Same `getMetadata(id)` called twice within one request → one underlying call.
- `getStatusBatch` coalescing: three rows each call with disjoint ID sets → one combined upstream call → correct per-caller split.
- `getStatusBatch` return: keys match input `MediaId` strings verbatim (e.g. `"movie:550"`, not `"550"`).
- `getInProgressSet` memoization: two callers in one request → one underlying `getInProgress` call; returns a `Set<MediaId>`; no `userId` parameter — uses the loader's constructor-scoped user.
- `hasPlugin` memoization: two rows checking the same capability in one request → one underlying `service_connections` lookup; distinct capabilities → distinct lookups; returns `boolean`.
- Error propagation: underlying call fails → all awaiting callers receive the same error.
- Non-dataloader methods are not memoized.

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
- `becauseYouWatched` `s` field with malformed media id (not `movie:NNN` / `tv:NNN`) → `home.bad_input`.
- `becauseYouWatched` pagination continuity: cursor `s` carries forward unchanged across pages even when `signals.recentSeed` would change mid-session.
- `becauseYouWatched` layout-synthesised initial cursor: given a `LayoutSignals` with `recentSeed = { tmdbId: "550", mediaType: "movie", ... }`, the layout handler encodes `{ v: 1, r: "becauseYouWatched", p: 1, s: "movie:550" }` and passes it as `opts.cursor` to the fetcher — round-trips through the same encode/decode path as client-supplied cursors and is accepted by Zod validation unchanged.
- `becauseYouWatched` initial cursor never null: under the contract the layout handler must not invoke the `becauseYouWatched` fetcher with `opts.cursor === null`. A test-double fetcher asserts the cursor it receives on page 1 decodes to `{ p: 1, s: <seed id> }`; the fetcher reads `s` from the cursor and never inspects any other source.

### `HomeFeedService` integration tests (`home-feed-service.test.ts`)

One test per user-state fixture:

- **No plugins:** `getLayout` → `rows: []`.
- **Shared TMDB only:** `getLayout` → `newReleases` only.
- **TMDB + feedback signal, no trackers:** `newReleases` + `becauseYouWatched` + `recommendedForYou` (thin).
- **TMDB + Trakt:** full eligible set with correct ordering per profile confidence.
- **Full install mid-rebuild:** reads current profile; ranking reflects stale-but-valid profile; no error.
- **Calendar cold-cache:** `calendarProgressCount` returns 0 when calendar data is cold; `upcomingForYou` dropped; no error.
- **`upcomingForYou` timeout vs. ok-empty vs. partial-empty:** timeout → row dropped; genuine empty fetch (all plugins succeeded with zero items) → row retained with `items: []`; some calendar plugins fail and successful ones return zero items → row dropped (outcome is `partial`, not `ok_empty`, so the exemption does not apply).
- **`getRowContent` eligibility re-check:** plugin removed between `getLayout` and `getRowContent` → `home.row_unavailable`; plugin still present, cursor past end → `{ items: [], cursor: null }`.
- **`getRowContent` timeout:** slow underlying fetch exceeds 3s → response is `{ items: [], cursor: null }` (no thrown error).
- **Cross-row exclusion:** in-progress item does not appear in `becauseYouWatched` results on page 1 or on scroll page 2; both pages call `ctx.dataloader.getInProgressSet()`, and the test asserts a single underlying `mediaService.getInProgress(userId)` call across signal computation + fetcher invocation (memoization holds).

Each fixture asserts the row set, order, and which rows carry `matchReason` / `progress` / `partial`.

### API contract tests

- oRPC input schema: `getLayout` rejects extra keys (strict); `getRowContent` requires `rowId` and `cursor`; unknown `rowId` → `home.bad_input`.
- oRPC output schema matches the published type in `@ent-mcp/shared`; no extraneous fields.
- Shape stability: snapshot test on a canonical fixture response.

### Degradation integration

- Each capability's aggregate with one plugin failing → `partial: true` on corresponding row.
- All plugins for a capability fail → row dropped (exception: `upcomingForYou` only when outcome is `ok_empty`, not on timeout/all-failed).
- `upcomingForYou` with genuine empty fetch → row retained with `items: []`.
- `upcomingForYou` timing out → row dropped (not retained as empty).
- `upcomingForYou` partial-empty (mixed plugin failure with zero items from survivors) → row dropped; outcome resolves to `partial`, so the `ok_empty` exemption does not fire.
- `getRowContent` for a row that became unavailable between layout calls → `home.row_unavailable`.
- Cursor past end of data → `{ items: [], cursor: null }`, not an error.
- `getStatusBatch` exceeds 1s budget → `status` omitted on affected items; row still returned; `partial` not set for this.

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

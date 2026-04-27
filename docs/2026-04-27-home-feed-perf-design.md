# Home Feed Performance Recovery

**Status:** Draft
**Date:** 2026-04-27
**Author:** Omid Astaraki
**Deps:** `2026-04-22-home-feed-design.md`, `2026-04-23-home-feed-frontend-design.md`, `2026-04-20-preference-engine-design.md`, `2026-04-26-plugin-fanart-design.md`

## Summary

Three home-feed endpoints regressed to 2–4s latency that does not improve across reloads:

- `/api/home/getRowContent` for `recommendedForYou` — ~4.1s on warm cache.
- `/api/home/getRowContent` for `newReleases` — ~2s intermittently.
- `/api/artwork/get` (batch of 21 items) — ~2s every load, even warm.

Investigation traced all three to a single root cascade: `PreferenceEngine.getItemFeatures` was bypassing the metadata cache (`skipCache: true`), causing 60 fresh TMDB `metadata.getDetails` calls per RFY page. Those calls saturate the TMDB rate limit; `newReleases.discover` and `artwork.getArtwork` then fail behind the same exhausted budget. None of the failures cache (the `aggregate_per_kind` strategy skips cache writes on all-fail), so the next request repeats the cycle.

This document specifies a coordinated fix across the preference engine, the dispatcher cache layer, the home feed cache key, and the client artwork hook. Expected post-fix latencies: RFY warm ~50ms, newReleases ~10ms, artwork above-fold cards render as cache hits return without being capped by the slowest sibling.

## Investigation findings

Timing logs added to `home/rows/recommended-for-you.ts`, `home/rows/new-releases.ts`, `home/index.ts`, `artwork/service.ts`, and `preferences/engine.ts` produced the breakdown below over six consecutive home-feed loads.

### RFY (`recommendedForYou`)

```
PE.enrichCandidates n=40 directHit=0 providerCall=40
PE.rankCandidates total=2040ms profile=1ms enrich(features)=2039ms score=0ms
PE.explainMatch total=2025ms profile=5ms features=2020ms     (×20 in parallel)
rfy total=4603ms rec=519ms rank+explain=4079ms build(status)=5ms
```

- `directHit=0`: every candidate has shallow features → forces `provider.getItemFeatures` for all 40.
- `enrich(features)=2039ms`: 40 parallel `metadata.getDetails` dispatches; capped by TMDB rate-limit retry (`RATE_LIMIT_BACKOFF_MS` = 2s).
- `explainMatch features=2020ms` × 20: each top-N explanation **re-fetches** the same features. Wall clock = 2s for the parallel wave.
- Total = enrich wave (2s) + explain wave (2s) = ~4s.

### newReleases

```
12:11:23 total=14ms   discover=14ms   ok_items     ← TMDB happy
12:11:36 total=2020ms discover=2020ms all_failed   ← TMDB rate-limited
12:11:46 total=2024ms discover=2024ms all_failed   ← still hammering
```

- `now` in cache key (`releaseDateGte`/`releaseDateLte`) → key changes every call → negative cache cannot absorb failures.
- Plugin failures coincide with the PE-driven TMDB load.

### artwork

```
items=21 cacheHits<=5ms=0  misses>5ms=21 maxEntry=190ms     ← TMDB happy, no cache writes
items=21 cacheHits<=5ms=19 misses>5ms=2  maxEntry=2016ms    ← 2 items rate-limited, cap whole batch
items=20 cacheHits<=5ms=0  misses>5ms=20 maxEntry=2127ms    ← all fail, no cache write
```

- `aggregate_per_kind` strategy skips `writeCache` when every provider failed (`aggregate-per-kind.ts:198`). Rate-limited items never warm the cache.
- Single-batch dispatch caps response on slowest item (`Promise.allSettled`).

### Root cause synthesis

PE's `skipCache: true` is the source. It hammers TMDB, exhausts the rate-limit budget, and starves the other two endpoints. None of the failures cache → every reload repeats the cascade.

## Goals

- RFY warm-cache request returns in <100ms.
- newReleases warm-cache request returns in <50ms; failures cache for the negative TTL window.
- Artwork above-the-fold cards render as soon as their per-item cache hit returns; one slow item never blocks others.
- No regression in match-reason quality on RFY (explainMatch must still produce reasons for top-N).
- TMDB call volume per RFY page reduced from ~60 to at most 1 per uncached candidate (i.e. zero on warm cache).

## Non-goals

- Replacing TMDB plugin or its rate-limiting behavior.
- Redesigning PreferenceEngine scoring weights or feature extraction.
- Server-driven prefetch, SSE, or streaming row delivery.
- Plugin runtime concurrency limiter (deferred; addressed if rate-limit pressure persists after this PR).
- Migrating cache backend to Redis (orthogonal).

## Design

Five changes in one PR. Sequenced so each is independently testable.

### Change 1 — PE: drop `skipCache: true` on feature reads

**File:** `apps/server/src/preferences/media-provider.ts:69-77`

Remove `skipCache: true` from `MediaServicePreferenceProvider.getItemFeatures`. Metadata cache TTL is 24h; rank/explain accepting 24h-stale features is acceptable (the design's 6h candidate cache already implies this tolerance).

The rebuild path (`apps/server/src/preferences/rebuild.ts`) calls `getItemFeatures` indirectly through the same provider. Audit shows rebuild runs against a stable feedback-log snapshot — fresh feature reads aren't load-bearing for correctness. If a rebuild needs forced fresh reads, a future enhancement can add an explicit `bypassCache` parameter; not required now.

**Expected effect:** RFY rank-time `enrich(features)` drops from ~2s to ~5ms on warm cache. First-ever rank for a user still pays one wave (~600ms with healthy TMDB).

### Change 2 — PE: thread features from rank into explain

**Files:**

- `apps/server/src/preferences/types.ts` — extend `RankedCandidate`
- `apps/server/src/preferences/scoring.ts` — thread features into output
- `apps/server/src/preferences/engine.ts` — new `explainRanked` method

**Correction (per spec review):** `RankedCandidate` (`types.ts:12-18`) currently carries `{ item, score, profileScore, confidence, topContributors }` — features are NOT on it. `rankCandidatesAgainst` (`scoring.ts:104-138`) receives `{ item, features }[]` and discards `features` when building the result at line 124-136. The fix has two parts:

1. **Extend the type:** add `features: CandidateFeatures` to `RankedCandidate`.
2. **Wire `scoring.ts:rankCandidatesAgainst`** to copy `candidates[i].features` into the returned entry alongside `topContributors`.

Then add `explainRanked(ranked: RankedCandidate): string | null` to `PreferenceEngine`. It calls `resolveProfileForMedia(userId, ranked.item.type)` then `explainAgainstProfile(ranked.features, profile)` — no provider call. The RFY row fetcher (`apps/server/src/home/rows/recommended-for-you.ts`) calls `explainRanked` instead of `explainMatch` for the top-N. Existing `explainMatch(userId, item)` retained for callers that don't have ranked entries (none today, but keeping it preserves the public surface).

**Expected effect:** explain wave drops from 2s to ~5ms (in-memory call). RFY warm-cache total falls into the ~50ms range.

### Change 3 — Dispatcher: negative cache on all-fail (two strategies)

**Correction (per spec review):** the original draft incorrectly stated that `dispatchPrimary` already writes empty results to the **negative** cache. It does not. `primary-with-enrichment.ts:122-127` writes `{ data: null, errors: [...], attempted: N }`, and `cache.ts:78-89` `ttlMsFor` checks `Object.keys(value).length === 0` on the raw value — the empty result has three keys (`data`, `errors`, `attempted`) so it's classified non-empty and gets `defaultCacheTtlSec` (24h for metadata). All-fail metadata calls are silently positive-cached for 24h today. This is the latent bug that turns Change 1 into a "trade always-slow for 24h-degraded" if not addressed alongside.

**File:** `apps/server/src/media/dispatch-cache.ts`

Extend `writeCache` with an optional explicit TTL override:

```ts
export async function writeCache<T>(
  req: DispatchRequest,
  capability: CapabilityDefinition,
  scope: ResolvedCapabilityScope,
  value: T,
  ttlOverrideMs?: number,
): Promise<void> {
  if (req.skipCache) return;
  const key = await cacheKeyFor(req, scope);
  const ttl = ttlOverrideMs ?? ttlMsFor(capability, value);
  await getCacheProvider().set(key, { v: value }, ttl);
}
```

**File:** `apps/server/src/media/strategies/aggregate-per-kind.ts:198-204`

Always write; use the override for all-fail:

```ts
await writeCache(req, capability, scope, bundle as T, allFailed ? NEGATIVE_TTL_MS : undefined);
if (!allFailed) {
  await applyInvalidations(req, capability);
}
```

**File:** `apps/server/src/media/strategies/primary-with-enrichment.ts:122-127`

Pass the same override on the empty-result path so `dispatchPrimary` stops 24h-caching transient TMDB failures:

```ts
if (successes.length === 0) {
  const empty: AggregateResult<T> = { data: null as T, errors, attempted: outcomes.length };
  // When every provider errored, this is a transient — short TTL prevents
  // a single rate-limit incident from poisoning rank/explain reads for 24h.
  // When every provider succeeded with no data (errors.length === 0), the
  // empty answer is stable, so leave TTL derivation to `ttlMsFor`.
  const isAllFail = outcomes.length > 0 && errors.length === outcomes.length;
  await writeCache(req, capability, scope, empty, isAllFail ? NEGATIVE_TTL_MS : undefined);
  return empty;
}
```

`NEGATIVE_TTL_MS = 60 * 1000` (60s). Matches the existing `1 * MIN` convention used by `watchHistory@v1`, `watchlist@v1`, `ratings@v1`, etc. for `negativeCacheTtlSec`. Short enough that real upstream recovery surfaces within a minute; long enough to break the per-request hammer cycle.

Define `NEGATIVE_TTL_MS` once in `dispatch-cache.ts` and import where used.

**Expected effect:**

- Artwork: once TMDB recovers, stops hammering within 60s.
- PE rank+explain after Change 1: a single rate-limited TMDB load no longer poisons feature reads for 24h. Worst case 60s of "ranking with thin features" before TMDB retry succeeds.

### Change 4 — newReleases: day-rounded cache key

**File:** `apps/server/src/home/rows/new-releases.ts:21-31`

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const result = await ctx.mediaService.discoverFeed({
  limit: opts.limit * (page + 1),
  releaseDateGte: today - 90 * DAY_MS,
  releaseDateLte: today + DAY_MS, // exclusive end-of-day so today's releases are visible
  sort: "popularity_desc",
  deadlineMs: ctx.deadlineMs,
});
```

Cache key now stable for the calendar day. Aligns with `metadata@v1`'s 24h positive TTL.

**Visible behavior change (per spec review):** the prior code used `releaseDateLte: now`, which excluded any title released later in the same UTC day. Day-rounding the lower bound only would inherit that exclusion and additionally hide tomorrow's just-released titles for users in negative-UTC timezones. Setting the upper bound to `today + DAY_MS` (exclusive end-of-day) keeps the key stable while making the same-day inclusion behavior explicit. Plugins must accept this as an inclusive `releaseDateLte` (TMDB's `discover` does); if a future plugin treats the bound as strict-less-than-day-start, the row will simply omit today's releases — acceptable degradation.

**Expected effect:** `discover` becomes a single TMDB hit per day per filter combo across all users. Subsequent calls are sub-5ms cache reads.

### Change 5 — Artwork: per-item dispatch with above-fold prioritization

**Per-call auth overhead (per spec review).** Better Auth's `auth.api.getSession({ headers })` (`auth/middleware.ts:67-78`) hits the session table on every request — `auth/config.ts` does not configure `session.cookieCache`, so 21 per-item POSTs would mean 21 session-table SELECTs per home load. To absorb this cost cleanly, this change includes:

**File:** `apps/server/src/auth/config.ts`

Enable Better Auth's signed-cookie session cache (5-minute window):

```ts
export const auth = betterAuth({
  // … existing config
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // seconds
    },
  },
  // …
});
```

The cookie holds a short-lived signed snapshot of the session; `getSession` reads it without touching the DB until expiry. Cross-cuts every authenticated route, not just home — incidental win.

**File:** `apps/client/src/hooks/use-artwork.ts`

Drop the module-level batch queue (`enqueue`, `flush`, `dispatchSlice`, `PENDING`, `flushTimer`). Replace with a direct per-item POST inside the tanstack-query `queryFn`:

```ts
async function fetchOne(item: ArtworkRequestItem): Promise<ArtworkBundle> {
  const res = await api.artwork.get.$post({ json: { items: [item] } });
  if (!res.ok) throw new Error(`artwork.get failed: HTTP ${res.status}`);
  const data = (await res.json()) as { results: Record<string, ArtworkBundle> };
  return data.results[item.key] ?? EMPTY_BUNDLE;
}

export function useArtwork(
  item: ArtworkRequestItem,
  opts: { enabled?: boolean } = {},
): UseQueryResult<ArtworkBundle> {
  return useQuery({
    queryKey: artworkQueryKey(item.key),
    queryFn: () => fetchOne(item),
    staleTime: 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    retry: 1,
    enabled: opts.enabled ?? true,
  });
}
```

tanstack-query's `queryKey: ["artwork", item.key]` already deduplicates two cards referencing the same canonical item — replaces the queue's per-key resolver fan-out.

**File:** `apps/client/src/hooks/use-in-view.ts` (new)

```ts
export function useInView(ref: RefObject<Element>, opts: { rootMargin?: string } = {}): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setInView(true)),
      { rootMargin: opts.rootMargin ?? "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, opts.rootMargin]);
  return inView;
}
```

Once true, stays true (one-shot) — the bundle should keep loading even when the card scrolls back out.

**Files:**

- `apps/client/src/components/home/hero.tsx` — pass `enabled: true`. Hero is always above the fold.
- `apps/client/src/components/home/sidebar-item.tsx` — pass `enabled: true`. Sidebar is always above the fold.
- `apps/client/src/components/home/card.tsx` — accept `priority` prop from parent; pass `enabled: priority || isInView`. Hook `useInView` on the card's own ref.
- `apps/client/src/components/home/row.tsx` — pass `priority={isFirstRow}` to its cards. First row of the layout is always above the fold; later rows gate on visibility.

**Above-fold definition:** hero + sidebar + first row.

**Server side:** No schema change. `artwork.get` already accepts `items: 1..50`; sending a single-item array is a valid call.

**Expected effect:**

- One slow item only delays its own card; siblings render immediately as their per-item cache hits return.
- Off-screen rows defer their entire artwork fetch until scrolled into view.
- Per-call auth cost is sub-ms after the first request in a 5-minute window (cookie cache), so per-item dispatch is genuinely cheap.

**Connection-multiplexing note (per spec review).** The original draft assumed HTTP/2 absorbs concurrent per-item POSTs. Vite dev server is HTTP/1.1, capped at 6 concurrent connections per origin — 21 above-fold cards would queue beyond the 6th. Two paths:

1. **Production deployment serves HTTP/2** (Caddy, nginx, Cloudflare default). Per-item parallelism multiplexes on a single connection. Document this as a deployment requirement.
2. **Dev experience accepts HTTP/1.1 queueing** during development. Functional but visibly slower locally; not a regression vs the current single-batch behavior.

This design accepts (1) for prod and (2) for dev — no client-side micro-batching is added. If profile data shows the dev queueing is intolerable, micro-batching first-row cards into one POST is a straightforward retrofit (queue gated by row index instead of debounce).

## Tests

Per `feedback#13`, every reported issue gets a regression test.

### Server-side

- `apps/server/src/preferences/__tests__/media-provider.test.ts` — assert `getItemFeatures` calls `dispatchPrimary` **without** `skipCache: true` (regression on reintroduction).
- `apps/server/src/preferences/__tests__/engine.test.ts` — when row fetcher calls rank then explain on same items, provider's `getItemFeatures` is called exactly once per item (not 1.5×). Also: `RankedCandidate.features` is populated and matches the input candidate's features.
- `apps/server/src/preferences/__tests__/rebuild.test.ts` — rebuild's `collectContributions` produces a profile when `getItemFeatures` returns from cache (i.e. no implicit dependency on `skipCache: true`).
- `apps/server/src/media/strategies/__tests__/aggregate-per-kind.test.ts` — when every provider fails, cache is written with empty bundle and `NEGATIVE_TTL_MS`. Subsequent call within TTL hits cache without any plugin invocation.
- `apps/server/src/media/strategies/__tests__/primary-with-enrichment.test.ts` — when every provider fails, the empty result is cached with `NEGATIVE_TTL_MS`, NOT `defaultCacheTtlSec`. Distinguishes from the all-succeed-with-no-data case which still uses `negativeCacheTtlSec` derivation.
- `apps/server/src/home/rows/__tests__/new-releases.test.ts` — two consecutive fetches within the same calendar day pass identical cache keys to `discoverFeed`. Across day boundary, key changes. Upper bound is `today + DAY_MS`, not `today`.

### End-to-end regression on reported bug

Per CLAUDE.md feedback#13, the user-visible bug is "subsequent home loads don't improve." Add an integration test:

- `apps/server/src/home/__tests__/home-feed-warm-cache.test.ts` — fixture: TMDB plugin succeeds. First `getRowContent(recommendedForYou)` warms cache. Second call within 1 minute returns in <100ms with no plugin invocations recorded. Same shape for `newReleases` and `artwork.get`.

### Client-side

- `apps/client/src/hooks/__tests__/use-artwork.test.ts` — replace existing batch-queue tests. Each `useArtwork` call fires one POST; tanstack-query dedupes by `queryKey`; `enabled: false` prevents the fetch.
- `apps/client/src/hooks/__tests__/use-in-view.test.ts` — observer fires `inView=true` once when intersection occurs; cleanup disconnects observer.
- `apps/client/src/components/home/__tests__/card.test.tsx` — `priority` prop overrides intersection gating; without it, card defers fetch until `useInView` returns true.
- `apps/client/src/components/home/__tests__/row.test.tsx` — first row passes `priority` to its cards; later rows do not.

## Migration / rollout

Single PR, no feature flag. Each change is independently revertable:

1. Cache changes in `aggregate-per-kind.ts` and `primary-with-enrichment.ts` are additive — `writeCache`'s new `ttlOverrideMs` parameter is optional; passing `undefined` reproduces existing behavior exactly.
2. `skipCache: true` removal is a one-line revert if regressions appear in rebuild correctness (Change 1's regression test guards this).
3. Day-rounded cache key is a one-line revert.
4. Artwork client rewrite is feature-isolated to `use-artwork.ts` + new `use-in-view.ts`. Server schema unchanged.
5. PE engine surface change adds new `explainRanked` method and a new `features` field on `RankedCandidate`; old `explainMatch` retained for callers that don't have ranked features handy.
6. Better Auth `cookieCache` enablement is a config-level toggle — disabling it reverts to per-request DB session lookups.

### Changesets

Per CLAUDE.md, every PR needs `.changeset/<slug>.md`. Released packages touched by this PR:

- `@ent-mcp/server` — `patch`. Body: "Recovered home feed performance — recommendations row, new releases row, and artwork batch now serve from cache on warm loads."
- `@ent-mcp/client` — `patch`. Body: "Artwork now loads per card with above-the-fold prioritization, so a single slow image no longer delays the rest of the row."

`@ent-mcp/shared` and `@ent-mcp/plugin-sdk` are not touched. No changeset for those.

## Open questions

- **TMDB rate-limit backoff:** currently 2s. Once PE pressure drops, evaluate whether retry is even useful, or should fail fast with negative cache only. Defer.
- **Per-plugin concurrency limit:** if newReleases or artwork still hits rate limits after Change 1, plugin-runtime needs a `maxConcurrent` knob. Out of scope.
- **PE rebuild path:** resolved. `rebuild.ts:200` only consumes `getItemFeatures`'s return value; nothing in `rebuild.ts` depends on freshness. Cached features are acceptable. No `bypassCache` parameter required.
- **`useInView` ref typing:** `RefObject<Element>` works for typical card root elements; verify no card uses `RefObject<HTMLAnchorElement>` shape that requires variance.
- **Above-fold scope:** "first row only" assumed sufficient. If first row + sidebar fetch alone fully saturates the user's bandwidth, second row may need to opt in too. Measure post-fix.
- **HTTP/2 in development:** Vite dev is HTTP/1.1 → 6-connection cap means 21 above-fold cards queue. Acceptable as a dev-only artifact for v1; revisit if dev-loop friction becomes a complaint.

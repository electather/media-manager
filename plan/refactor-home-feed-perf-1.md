---
goal: Recover home feed warm-cache latency for /api/home/getRowContent and /api/artwork/get
version: 1.0
date_created: 2026-04-27
last_updated: 2026-04-27
owner: Omid Astaraki
status: "Planned"
tags: ["bug", "refactor", "performance", "home-feed", "preference-engine", "cache"]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implementation plan for `docs/2026-04-27-home-feed-perf-design.md`. The home feed surfaces three slow endpoints (`recommendedForYou` 4s, `newReleases` 2s, `artwork.get` 2s) that do not improve across reloads. Root cause: `PreferenceEngine.getItemFeatures` bypasses the metadata cache via `skipCache: true`, saturating the TMDB rate limit; `dispatchPrimary` then 24h-positive-caches the all-fail response (latent bug); `aggregate-per-kind` skips cache writes on all-fail entirely; `newReleases` includes `Date.now()` in its cache key. Five coordinated changes ship on branch `fix/home-feed-perf` in a single PR: drop `skipCache:true`, thread features from rank into explain, install short-TTL negative caching in both dispatch strategies, day-round the `newReleases` cache key, and split the artwork batch endpoint into per-item RPCs with above-fold prioritization (plus Better Auth `session.cookieCache` to absorb the per-call auth cost).

## 1. Requirements & Constraints

- **REQ-001**: All five changes ship in one PR on branch `fix/home-feed-perf`.
- **REQ-002**: Per CLAUDE.md feedback#13: every reported issue gets a regression test.
- **REQ-003**: Per CLAUDE.md, every PR includes `.changeset/<slug>.md` for released packages touched (`@ent-mcp/server`, `@ent-mcp/client`).
- **REQ-004**: Per CLAUDE.md, run `vp check` and `vp test` before every commit.
- **REQ-005**: RFY warm-cache `home.getRowContent` returns in <100ms.
- **REQ-006**: `newReleases` warm-cache returns in <50ms; failures cache for the negative TTL window.
- **REQ-007**: Artwork above-the-fold cards render as soon as their per-item cache hit returns; one slow item never blocks others.
- **REQ-008**: TMDB call volume per RFY page reduced from ~60 to at most 1 per uncached candidate (zero on warm cache).
- **REQ-009**: No regression in match-reason quality on RFY — `explainRanked` must produce reasons for top-N.
- **CON-001**: Better Auth `session.cookieCache.maxAge` accepts seconds; use `5 * 60`.
- **CON-002**: `NEGATIVE_TTL_MS = 60 * 1000` matches the existing `1 * MIN` `negativeCacheTtlSec` precedent (`watchHistory@v1`, `watchlist@v1`, `ratings@v1`).
- **CON-003**: Vite dev server is HTTP/1.1 with 6-connection cap. Per-item dispatch accepts dev-time queueing; production deployments must serve HTTP/2 for full benefit.
- **CON-004**: `RankedCandidate` is a server-only type (`apps/server/src/preferences/types.ts`). Adding `features: CandidateFeatures` does not cross the wire.
- **CON-005**: Diagnostic timing logs in `apps/server/src/{artwork,home,preferences}` are currently uncommitted on `fix/home-feed-perf` and must be removed before the PR is opened.
- **CON-006**: Do NOT use `--no-verify`, `--no-edit`, or any hook-skipping flag on commits.
- **CON-007**: Do NOT attribute Claude in code or commit messages (per `~/.claude/CLAUDE.md`).
- **GUD-001**: Commit messages: imperative mood, concise. Conventional Commits prefixes (`fix(scope):`, `feat(scope):`, `test(scope):`, `chore(scope):`, `refactor(scope):`).
- **GUD-002**: Small, focused commits preferred. Each phase below maps to one commit.
- **PAT-001**: Use `vp` toolchain commands. Never call `pnpm`/`npm`/`vitest`/`oxlint` directly.
- **PAT-002**: Tests colocate in `__tests__/` next to the file under test, matching existing project layout.
- **PAT-003**: Internal-only changeset entries use empty frontmatter and no body; user-facing changeset entries follow the 1–2 non-technical sentence rule (memory#11).

## 2. Implementation Steps

### Implementation Phase 1 — Cache layer foundations

- GOAL-001: Land the `writeCache` TTL override and `NEGATIVE_TTL_MS` constant so subsequent phases can use them. No behavior change yet — additive only.

| Task     | Description                                                                                                                                                                                                                                                                                 | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-001 | In `apps/server/src/media/dispatch-cache.ts`, export `NEGATIVE_TTL_MS = 60 * 1000`. Add a one-line comment citing the `1 * MIN` precedent.                                                                                                                                                  |           |      |
| TASK-002 | In `apps/server/src/media/dispatch-cache.ts`, change `writeCache` signature to `writeCache<T>(req, capability, scope, value, ttlOverrideMs?: number)`. Implementation: `const ttl = ttlOverrideMs ?? ttlMsFor(capability, value);`. Behavior unchanged when `ttlOverrideMs` is `undefined`. |           |      |
| TASK-003 | Run `vp check` — confirm no type errors propagate from the optional parameter.                                                                                                                                                                                                              |           |      |
| TASK-004 | Run `vp test` — confirm all 1038 existing tests still pass (no consumer breakage from the additive parameter).                                                                                                                                                                              |           |      |
| TASK-005 | Commit on `fix/home-feed-perf`: `refactor(server): add ttlOverrideMs to writeCache`.                                                                                                                                                                                                        |           |      |

### Implementation Phase 2 — Negative cache on all-fail (both strategies)

- GOAL-002: Use the new `NEGATIVE_TTL_MS` override in both `aggregate-per-kind` and `primary-with-enrichment` so transient TMDB failures stop self-amplifying.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                             | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-006 | In `apps/server/src/media/strategies/aggregate-per-kind.ts:198-204`, replace the `if (!allFailed) { writeCache(...); applyInvalidations(...); }` block with: always-call `writeCache(req, capability, scope, bundle, allFailed ? NEGATIVE_TTL_MS : undefined)`; gate `applyInvalidations` on `!allFailed`. Import `NEGATIVE_TTL_MS` from `../dispatch-cache`.           |           |      |
| TASK-007 | In `apps/server/src/media/strategies/primary-with-enrichment.ts:122-127`, in the `successes.length === 0` branch compute `const isAllFail = outcomes.length > 0 && errors.length === outcomes.length;`. Pass `isAllFail ? NEGATIVE_TTL_MS : undefined` to `writeCache`. Add comment distinguishing all-fail (transient) from all-succeed-with-no-data (stable absence). |           |      |
| TASK-008 | In `apps/server/src/media/strategies/__tests__/aggregate-per-kind.test.ts`, add test: when every provider fails, cache is written with empty bundle at `NEGATIVE_TTL_MS`. Subsequent call within 60s hits cache without invoking any plugin. Mock the cache provider's `set` to assert TTL value.                                                                       |           |      |
| TASK-009 | In `apps/server/src/media/strategies/__tests__/primary-with-enrichment.test.ts`, add test: when every provider fails, empty `AggregateResult` is cached with `NEGATIVE_TTL_MS`. Distinguish from all-succeed-with-empty-data case which still derives TTL via `ttlMsFor`.                                                                                               |           |      |
| TASK-010 | Run `vp check` and `vp test`. Confirm both new tests pass and no existing tests fail.                                                                                                                                                                                                                                                                                   |           |      |
| TASK-011 | Commit on `fix/home-feed-perf`: `fix(server): negative-cache transient all-fail in dispatch strategies`.                                                                                                                                                                                                                                                                |           |      |

### Implementation Phase 3 — PreferenceEngine: drop skipCache + thread features

- GOAL-003: Stop bypassing the metadata cache in `getItemFeatures` and eliminate redundant feature reads in `explainMatch` by carrying features through `RankedCandidate`.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                            | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-012 | In `apps/server/src/preferences/media-provider.ts:69-77`, delete the `skipCache: true` line from the `dispatchPrimary` call inside `getItemFeatures`. Keep the rest of the method unchanged.                                                                                                                                                                                                           |           |      |
| TASK-013 | In `apps/server/src/preferences/types.ts:12-18`, add `features: CandidateFeatures;` to the `RankedCandidate` interface. Adjust import if `CandidateFeatures` not already in scope (it is — same file).                                                                                                                                                                                                 |           |      |
| TASK-014 | In `apps/server/src/preferences/scoring.ts:104-138`, in `rankCandidatesAgainst`'s final `.map((entry) => ...)`, copy `candidates[entry.index]!.features` into the returned object alongside `topContributors`.                                                                                                                                                                                         |           |      |
| TASK-015 | In `apps/server/src/preferences/engine.ts`, add public method `explainRanked(userId: string, ranked: RankedCandidate): Promise<string \| null>`. Implementation: read profile via `resolveProfileForMedia(userId, ranked.item.type)`, then return `explainAgainstProfile(ranked.features, profile)`. No provider call.                                                                                 |           |      |
| TASK-016 | In `apps/server/src/home/rows/recommended-for-you.ts`, change `rankCandidates` helper to return `RankedCandidate[]` directly (instead of the local `RankedItem[]` shape). Replace the `safeExplain(ctx, item)` call inside `rankCandidates` with `ctx.preferenceEngine.explainRanked(ctx.userId, rankedEntry).catch(() => null)`. Drop the now-unused `safeExplain` helper if no other caller remains. |           |      |
| TASK-017 | In `apps/server/src/preferences/__tests__/media-provider.test.ts`, add (or extend) test: `getItemFeatures` invokes `dispatchPrimary` without `skipCache: true`. Assert via spy on `dispatchPrimary` that the request payload omits `skipCache` (or has `skipCache: undefined`).                                                                                                                        |           |      |
| TASK-018 | In `apps/server/src/preferences/__tests__/engine.test.ts`, add test: when a row fetcher calls `rankCandidates` then `explainRanked` for top-N, the underlying `provider.getItemFeatures` is called exactly once per item (not twice). Use a counting fake provider.                                                                                                                                    |           |      |
| TASK-019 | In `apps/server/src/preferences/__tests__/engine.test.ts`, add test: `RankedCandidate.features` returned from `rankCandidates` is the same object (deep-equal) as the input candidate's features.                                                                                                                                                                                                      |           |      |
| TASK-020 | In `apps/server/src/preferences/__tests__/rebuild.test.ts` (extend if exists; create if not), add test: rebuild's `collectContributions` produces a profile when `getItemFeatures` returns from a cached metadata response. Confirms no implicit dependency on `skipCache: true`.                                                                                                                      |           |      |
| TASK-021 | Run `vp check` and `vp test`. All four new tests pass.                                                                                                                                                                                                                                                                                                                                                 |           |      |
| TASK-022 | Commit on `fix/home-feed-perf`: `fix(server): cache PE feature reads and reuse them in explain`.                                                                                                                                                                                                                                                                                                       |           |      |

### Implementation Phase 4 — newReleases day-rounded cache key

- GOAL-004: Stabilize `newReleases` cache key for the calendar day so the 24h positive TTL is actually exploitable, while keeping today's releases visible.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                               | Completed | Date |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-023 | In `apps/server/src/home/rows/new-releases.ts:21-31`, replace `const now = Date.now()` and the inline `ninetyDaysMs` with: `const DAY_MS = 24 * 60 * 60 * 1000; const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;`. Set `releaseDateGte: today - 90 * DAY_MS`, `releaseDateLte: today + DAY_MS`. Add a comment explaining the upper bound is exclusive end-of-day so today's releases stay visible. |           |      |
| TASK-024 | In `apps/server/src/home/rows/__tests__/new-releases.test.ts`, add test: two consecutive `fetch` calls within the same calendar day pass identical `releaseDateGte`/`releaseDateLte` values to `mediaService.discoverFeed`. Use `vi.useFakeTimers()` to advance time within the day.                                                                                                                      |           |      |
| TASK-025 | In the same test file, add test: across the day boundary the values change. Use `vi.setSystemTime` to step over UTC midnight.                                                                                                                                                                                                                                                                             |           |      |
| TASK-026 | In the same test file, add test: `releaseDateLte` equals `today + DAY_MS` (not `today`).                                                                                                                                                                                                                                                                                                                  |           |      |
| TASK-027 | Run `vp check` and `vp test`. All three new tests pass.                                                                                                                                                                                                                                                                                                                                                   |           |      |
| TASK-028 | Commit on `fix/home-feed-perf`: `fix(server): stabilise newReleases cache key on day boundary`.                                                                                                                                                                                                                                                                                                           |           |      |

### Implementation Phase 5 — Better Auth cookieCache + per-item artwork dispatch

- GOAL-005: Enable signed-cookie session caching to absorb per-call auth overhead; rewrite the artwork client hook for per-item RPC with above-fold prioritization via `useInView`.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                               | Completed | Date                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- | --- | --- |
| TASK-029 | In `apps/server/src/auth/config.ts`, add `session: { cookieCache: { enabled: true, maxAge: 5 * 60 } }` to the `betterAuth({...})` call. Place after the `database` block. Add a comment noting the 5-minute window.                                                                                                                                                                                                       |           |                                                                                               |
| TASK-030 | Run `vp check`. Confirm Better Auth's TypeScript surface accepts the new config (the `session.cookieCache` shape is defined in the installed `better-auth` version).                                                                                                                                                                                                                                                      |           |                                                                                               |
| TASK-031 | Create `apps/client/src/hooks/use-in-view.ts` exporting `useInView(ref: RefObject<Element>, opts?: { rootMargin?: string }): boolean`. Implementation: `useState<boolean>(false)`, `useEffect` constructing an `IntersectionObserver` with `rootMargin: opts.rootMargin ?? "200px"`. On first `isIntersecting`, set state to `true` (one-shot — does NOT flip back to `false` on exit). Cleanup disconnects the observer. |           |                                                                                               |
| TASK-032 | In `apps/client/src/hooks/__tests__/use-in-view.test.ts`, add tests: (a) returns `false` initially; (b) returns `true` after observer fires `isIntersecting`; (c) stays `true` after subsequent non-intersecting entries; (d) cleanup disconnects the observer. Mock `IntersectionObserver` globally in the test setup if not already mocked.                                                                             |           |                                                                                               |
| TASK-033 | In `apps/client/src/hooks/use-artwork.ts`, delete the module-level batch queue: `enqueue`, `flush`, `dispatchSlice`, `PENDING`, `flushTimer`, `FLUSH_DEBOUNCE_MS`, `MAX_BATCH_SIZE`, the `Pending` interface. Keep `EMPTY_BUNDLE` and `artworkQueryKey`.                                                                                                                                                                  |           |                                                                                               |
| TASK-034 | In the same file, add a top-level `async function fetchOne(item: ArtworkRequestItem): Promise<ArtworkBundle>` that POSTs `{ items: [item] }` to `api.artwork.get.$post` and returns `data.results[item.key] ?? EMPTY_BUNDLE`. Throws on non-OK.                                                                                                                                                                           |           |                                                                                               |
| TASK-035 | In the same file, change `useArtwork(item)` signature to `useArtwork(item, opts: { enabled?: boolean } = {})`. Pass `queryFn: () => fetchOne(item)` and `enabled: opts.enabled ?? true` into `useQuery`. Retain `staleTime`, `gcTime`, `retry: 1`.                                                                                                                                                                        |           |                                                                                               |
| TASK-036 | In `apps/client/src/hooks/__tests__/use-artwork.test.ts`, replace existing batch-queue tests. New tests: (a) each `useArtwork` invocation results in one POST containing exactly that one item; (b) two `useArtwork` calls with the same `key` are deduplicated by tanstack-query (one POST); (c) `enabled: false` prevents the fetch entirely; (d) failure sets bundle to `EMPTY_BUNDLE` after retry exhaustion.         |           |                                                                                               |
| TASK-037 | In `apps/client/src/components/home/hero.tsx:29`, no change to the `useArtwork({...})` call. Hero is always above-fold; the default `enabled: true` already applies. Verify and add a one-line comment for clarity.                                                                                                                                                                                                       |           |                                                                                               |
| TASK-038 | In `apps/client/src/components/home/sidebar-item.tsx:22`, same as above — sidebar is always above-fold. Verify, add comment.                                                                                                                                                                                                                                                                                              |           |                                                                                               |
| TASK-039 | In `apps/client/src/components/home/card.tsx`, accept new prop `priority?: boolean`. Add a `useRef<HTMLAnchorElement>(null)` and `useInView(ref)`. Pass `enabled: priority                                                                                                                                                                                                                                                |           | isInView`to the existing`useArtwork({...})`call. Attach the ref to the rendered`<a>` element. |     |     |
| TASK-040 | In `apps/client/src/components/home/__tests__/card.test.tsx`, add tests: (a) when `priority` is true, `useArtwork` is called with `enabled: true` regardless of intersection; (b) without `priority`, `enabled` follows the `useInView` mock; (c) ref is attached to the anchor element. Use a mock `useInView` that the test can flip.                                                                                   |           |                                                                                               |
| TASK-041 | In `apps/client/src/components/home/row.tsx`, accept new prop `isFirstRow?: boolean`. When rendering each `Card`, pass `priority={isFirstRow}`.                                                                                                                                                                                                                                                                           |           |                                                                                               |
| TASK-042 | In `apps/client/src/components/home/__tests__/row.test.tsx`, add test: when `isFirstRow` is true, every `Card` rendered receives `priority`. When false, none do.                                                                                                                                                                                                                                                         |           |                                                                                               |
| TASK-043 | In `apps/client/src/components/home/home-feed.tsx` (or wherever `Row` is iterated), pass `isFirstRow={index === 0}` for the main rows array. Confirm the prop wires through to the test fixtures.                                                                                                                                                                                                                         |           |                                                                                               |
| TASK-044 | Run `vp check` and `vp test` (both server and client). All new tests pass.                                                                                                                                                                                                                                                                                                                                                |           |                                                                                               |
| TASK-045 | Commit on `fix/home-feed-perf`: `feat(client,server): per-item artwork dispatch with above-fold priority`.                                                                                                                                                                                                                                                                                                                |           |                                                                                               |

### Implementation Phase 6 — End-to-end regression test on the reported bug

- GOAL-006: Per CLAUDE.md feedback#13, codify the user-visible bug ("subsequent home loads don't improve") as a test that fails today and passes after the fix.

| Task     | Description                                                                                                                                                                                                                                                    | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-046 | Create `apps/server/src/home/__tests__/home-feed-warm-cache.test.ts`. Fixture: TMDB plugin returns successful metadata responses on first call, fails (rate-limit) on subsequent attempts. Construct a `HomeFeedService` with a counted plugin invoker.        |           |      |
| TASK-047 | First test: call `getRowContent` for `recommendedForYou` twice within 1 minute. Assert second call returns in <100ms (use `performance.now()` deltas) and that `dispatchPrimary` invocation counter for `metadata.getDetails` does not increase between calls. |           |      |
| TASK-048 | Second test: same shape for `newReleases` — second call within calendar-day cache window does not invoke the plugin.                                                                                                                                           |           |      |
| TASK-049 | Third test: `artwork.get` for the same item twice; second call hits cache (no plugin invocation).                                                                                                                                                              |           |      |
| TASK-050 | Run `vp test` — confirm the new file's tests pass on the fixed code path. (Optional: temporarily revert one of the fixes to confirm the test fails as expected, then restore.)                                                                                 |           |      |
| TASK-051 | Commit on `fix/home-feed-perf`: `test(server): warm-cache regression for home feed performance`.                                                                                                                                                               |           |      |

### Implementation Phase 7 — Cleanup, changesets, final verification

- GOAL-007: Remove the diagnostic timing logs added during investigation; add changesets; run final checks; ensure branch is ready for PR.

| Task     | Description                                                                                                                                                                                                                                                                                                    | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-052 | Revert the timing-log additions in `apps/server/src/artwork/service.ts` (the `consola.info` `[perf] artwork ...` line and the `perEntry` array machinery around the `Promise.allSettled`).                                                                                                                     |           |      |
| TASK-053 | Revert the timing-log additions in `apps/server/src/home/index.ts` (the `consola.info` `[perf] getRowContent ...` line and the surrounding `t0 / tEligible / tFetch` instrumentation in `getRowContent`).                                                                                                      |           |      |
| TASK-054 | Revert the timing-log additions in `apps/server/src/home/rows/new-releases.ts` (the `t0 / tDiscoverStart / tDiscover / tBuildStart / tBuild` instrumentation and the `[perf] newReleases ...` log line).                                                                                                       |           |      |
| TASK-055 | Revert the timing-log additions in `apps/server/src/home/rows/recommended-for-you.ts` (the `t0 / tFetchStart / tFetch / tRankStart / tRank / tBuildStart / tBuild` instrumentation and the `[perf] rfy ...` log line).                                                                                         |           |      |
| TASK-056 | Revert the timing-log additions in `apps/server/src/preferences/engine.ts` (the `consola` import; `[perf] PE.rankCandidates ...`, `[perf] PE.enrichCandidates ...`, `[perf] PE.explainMatch ...` log lines; the `counters` parameter wiring on `featuresForCandidate`).                                        |           |      |
| TASK-057 | Run `vp check` to catch any leftover unused imports from the timing-log removal.                                                                                                                                                                                                                               |           |      |
| TASK-058 | Create `.changeset/home-feed-perf-server.md` with frontmatter `"@ent-mcp/server": patch` and body: `Recovered home feed performance — recommendations row, new releases row, and artwork batch now serve from cache on warm loads.`                                                                            |           |      |
| TASK-059 | Create `.changeset/home-feed-perf-client.md` with frontmatter `"@ent-mcp/client": patch` and body: `Artwork now loads per card with above-the-fold prioritization, so a single slow image no longer delays the rest of the row.`                                                                               |           |      |
| TASK-060 | Run `vp check` and `vp test` — full pass required before PR.                                                                                                                                                                                                                                                   |           |      |
| TASK-061 | Commit on `fix/home-feed-perf`: `chore: remove diagnostic timing logs and add changesets`.                                                                                                                                                                                                                     |           |      |
| TASK-062 | Manual verification: start `vp dev`, hard-refresh home, observe network tab. Confirm `getRowContent` for `recommendedForYou` returns <100ms on second load; `artwork.get` POSTs are per-item (one POST per visible card); below-fold cards do not POST until scrolled. Capture timings for the PR description. |           |      |

## 3. Alternatives

- **ALT-001**: Per-request feature cache as engine state (instead of threading features through `RankedCandidate`). Rejected — introduces request lifecycle management, shared mutable state, and is harder to test in isolation than the explicit type extension.
- **ALT-002**: Global LRU cache for `getItemFeatures` results inside `MediaServicePreferenceProvider`. Rejected — duplicates the dispatcher's existing 24h metadata cache; an extra layer hides cache-key correctness issues.
- **ALT-003**: Concurrency limiter on TMDB plugin (e.g. `p-limit=4`). Deferred — Change 1 alone reduces TMDB volume by ~60×; revisit only if rate-limit pressure persists post-fix.
- **ALT-004**: Pre-rank top-K nightly into `preference_profiles`. Rejected for v1 — introduces a job dependency and stale-rank risk; the warm-cache path with cached features is fast enough.
- **ALT-005**: Skip `explainMatch` on scroll pages (matchReason only on first page). Rejected — UX regression and unnecessary once features are cached.
- **ALT-006**: Server-side micro-batching of artwork above-fold (e.g. one POST per row). Deferred — added complexity for marginal HTTP/1.1-dev-only gain. Per-item with `cookieCache` is acceptable.
- **ALT-007**: Move newReleases date filter out of input entirely (plugin computes "last 90 days"). Rejected — cross-plugin contract change, larger blast radius than rounding.
- **ALT-008**: Round `now` to the day on the lower bound only (keep `releaseDateLte: now`). Rejected — would still vary the upper bound and cause cache misses; also hides today's releases.

## 4. Dependencies

- **DEP-001**: `better-auth` package — `session.cookieCache` config shape. Verified compatible with the version in `apps/server/package.json` (Phase 5).
- **DEP-002**: `@tanstack/react-query` — used by `useArtwork`'s per-item dispatch and request deduplication via `queryKey`.
- **DEP-003**: `IntersectionObserver` — browser-native; required for `useInView`. No polyfill needed (project targets evergreen browsers).
- **DEP-004**: `vp` toolchain (Vite+) — `vp check`, `vp test`, `vp dev` for verification.
- **DEP-005**: Existing test harness in `apps/server/src/preferences/__tests__` and `apps/client/src/components/home/__tests__` for placement of new tests.
- **DEP-006**: `consola` — already imported in target files; used for the existing `logger` surface.

## 5. Files

- **FILE-001**: `apps/server/src/media/dispatch-cache.ts` — add `NEGATIVE_TTL_MS` export and `ttlOverrideMs` parameter to `writeCache`.
- **FILE-002**: `apps/server/src/media/strategies/aggregate-per-kind.ts` — always-write semantics with `NEGATIVE_TTL_MS` on all-fail.
- **FILE-003**: `apps/server/src/media/strategies/primary-with-enrichment.ts` — use `NEGATIVE_TTL_MS` for transient all-fail empty results.
- **FILE-004**: `apps/server/src/media/strategies/__tests__/aggregate-per-kind.test.ts` — new negative-cache tests.
- **FILE-005**: `apps/server/src/media/strategies/__tests__/primary-with-enrichment.test.ts` — new negative-cache tests.
- **FILE-006**: `apps/server/src/preferences/media-provider.ts` — drop `skipCache: true` on `getItemFeatures`.
- **FILE-007**: `apps/server/src/preferences/types.ts` — extend `RankedCandidate` with `features: CandidateFeatures`.
- **FILE-008**: `apps/server/src/preferences/scoring.ts` — thread `candidates[i].features` into the returned `RankedCandidate`.
- **FILE-009**: `apps/server/src/preferences/engine.ts` — add `explainRanked(userId, ranked)` method.
- **FILE-010**: `apps/server/src/home/rows/recommended-for-you.ts` — switch top-N explanation path to `explainRanked`.
- **FILE-011**: `apps/server/src/preferences/__tests__/media-provider.test.ts` — assert no `skipCache: true` regression.
- **FILE-012**: `apps/server/src/preferences/__tests__/engine.test.ts` — assert single `getItemFeatures` call per item across rank+explain; assert `RankedCandidate.features` populated.
- **FILE-013**: `apps/server/src/preferences/__tests__/rebuild.test.ts` — assert rebuild tolerates cached features.
- **FILE-014**: `apps/server/src/home/rows/new-releases.ts` — day-rounded `releaseDateGte`/`releaseDateLte`.
- **FILE-015**: `apps/server/src/home/rows/__tests__/new-releases.test.ts` — cache-key stability tests.
- **FILE-016**: `apps/server/src/auth/config.ts` — enable `session.cookieCache`.
- **FILE-017**: `apps/client/src/hooks/use-in-view.ts` — new hook.
- **FILE-018**: `apps/client/src/hooks/__tests__/use-in-view.test.ts` — new tests.
- **FILE-019**: `apps/client/src/hooks/use-artwork.ts` — drop batch queue, switch to per-item dispatch with `enabled` flag.
- **FILE-020**: `apps/client/src/hooks/__tests__/use-artwork.test.ts` — new per-item dispatch tests.
- **FILE-021**: `apps/client/src/components/home/card.tsx` — accept `priority`, attach ref, gate `useArtwork` on `priority || useInView(ref)`.
- **FILE-022**: `apps/client/src/components/home/__tests__/card.test.tsx` — `priority` and viewport-gate tests.
- **FILE-023**: `apps/client/src/components/home/row.tsx` — accept `isFirstRow`, propagate as `priority` to children.
- **FILE-024**: `apps/client/src/components/home/__tests__/row.test.tsx` — `isFirstRow` propagation test.
- **FILE-025**: `apps/client/src/components/home/home-feed.tsx` — pass `isFirstRow={index === 0}` to the rendered `Row` list.
- **FILE-026**: `apps/server/src/home/__tests__/home-feed-warm-cache.test.ts` — new end-to-end regression test.
- **FILE-027**: `.changeset/home-feed-perf-server.md` — patch entry for `@ent-mcp/server`.
- **FILE-028**: `.changeset/home-feed-perf-client.md` — patch entry for `@ent-mcp/client`.
- **FILE-029**: `apps/server/src/artwork/service.ts` — REMOVE diagnostic timing log.
- **FILE-030**: `apps/server/src/home/index.ts` — REMOVE diagnostic timing log in `getRowContent`.
- **FILE-031**: `apps/server/src/home/rows/new-releases.ts` (cleanup) — REMOVE diagnostic timing log (separate from FILE-014's day-rounding edit).
- **FILE-032**: `apps/server/src/home/rows/recommended-for-you.ts` (cleanup) — REMOVE diagnostic timing log (separate from FILE-010's `explainRanked` edit).
- **FILE-033**: `apps/server/src/preferences/engine.ts` (cleanup) — REMOVE diagnostic timing log and the `counters` parameter on `featuresForCandidate` (separate from FILE-009's `explainRanked` addition).

## 6. Testing

- **TEST-001**: `aggregate-per-kind.test.ts` — all-fail case writes empty bundle at `NEGATIVE_TTL_MS`; second call within 60s hits cache without plugin invocation.
- **TEST-002**: `primary-with-enrichment.test.ts` — all-fail case writes empty `AggregateResult` at `NEGATIVE_TTL_MS`; all-succeed-with-no-data case still uses `ttlMsFor` derivation.
- **TEST-003**: `media-provider.test.ts` — `getItemFeatures` invokes `dispatchPrimary` without `skipCache: true`.
- **TEST-004**: `engine.test.ts` — `rankCandidates` followed by `explainRanked` for top-N invokes provider exactly once per item.
- **TEST-005**: `engine.test.ts` — `RankedCandidate.features` is populated on every returned entry and matches input.
- **TEST-006**: `rebuild.test.ts` — `collectContributions` succeeds when `getItemFeatures` returns from a cached metadata response.
- **TEST-007**: `new-releases.test.ts` — same calendar day → identical `releaseDateGte`/`releaseDateLte`; across UTC midnight → different values; upper bound equals `today + DAY_MS`.
- **TEST-008**: `use-in-view.test.ts` — initial false; turns true on intersection; stays true on subsequent non-intersecting entries; cleanup disconnects observer.
- **TEST-009**: `use-artwork.test.ts` — single-item POST per call; tanstack-query dedupes by key; `enabled: false` skips fetch; failure resolves to `EMPTY_BUNDLE`.
- **TEST-010**: `card.test.tsx` — `priority` overrides `useInView`; without `priority`, fetch gated on intersection; ref attached to anchor.
- **TEST-011**: `row.test.tsx` — `isFirstRow` propagates `priority` to all child cards; `false` propagates none.
- **TEST-012**: `home-feed-warm-cache.test.ts` — second `getRowContent` for `recommendedForYou` within 60s returns <100ms with no metadata plugin call; same for `newReleases` within day; same for `artwork.get` for repeated items.

## 7. Risks & Assumptions

- **RISK-001**: PE rebuild path subtly relies on fresh metadata even though static analysis doesn't show it. Mitigation: TASK-020 codifies the assumption as a regression test.
- **RISK-002**: Better Auth `cookieCache` ships stale role/permission state for up to 5 minutes. Mitigation: `requirePermission` middleware does its own DB fetch (`loadUserRole` at `auth/middleware.ts:53-57`) so per-permission gating is not affected; only generic `requireSession` reads the cookie. Acceptable.
- **RISK-003**: HTTP/1.1 in development queues the 6th+ above-fold artwork POST until earlier ones return. Mitigation: documented in the spec's open questions; revisit only if dev-loop pain becomes a complaint.
- **RISK-004**: `IntersectionObserver` mocking in vitest test environment requires global setup — confirm the existing client test harness already provides it (commonly via `happy-dom` or a manual global). If not, add one in TASK-032.
- **RISK-005**: The diagnostic timing logs interleaved with code-change edits in PE and home rows. Cleanup tasks (TASK-052..056) must run AFTER the corresponding feature commits to avoid reverting real changes.
- **RISK-006**: `RankedCandidate` is consumed by other call sites (e.g. `engine.ts:renderMatchReason`). Adding a non-optional field is a type-level breaking change for any external test fixture. Mitigation: search for `RankedCandidate {` literals across `apps/server` and update fixtures during TASK-013.
- **ASSUMPTION-001**: TMDB rate-limit retry path triggers when the budget is exhausted; this is observed empirically in the diagnostic logs, not specified in plugin contract.
- **ASSUMPTION-002**: `mediaService.discoverFeed` and the underlying TMDB plugin treat `releaseDateLte` as inclusive — TMDB's `discover` API does. If a future plugin treats it strict-less-than, today's releases drop silently (acceptable degradation per spec).
- **ASSUMPTION-003**: The session cookie cache shape (`enabled`, `maxAge` in seconds) is supported by the installed Better Auth version.
- **ASSUMPTION-004**: `apps/client/src/components/home/home-feed.tsx` is the rendering site for the `Row` list; if `Row` is rendered elsewhere, TASK-043 must locate that site.
- **ASSUMPTION-005**: `apps/client/src/components/home/card.tsx`'s root element is a `<a>` and accepts a forwarded ref. If not, TASK-039 introduces a wrapper `<div>` for the ref.

## 8. Related Specifications / Further Reading

- `docs/2026-04-27-home-feed-perf-design.md` — design document driving this plan.
- `docs/2026-04-22-home-feed-design.md` — backend home-feed spec.
- `docs/2026-04-23-home-feed-frontend-design.md` — frontend home-feed spec.
- `docs/2026-04-20-preference-engine-design.md` — PreferenceEngine contracts.
- `docs/2026-04-26-plugin-fanart-design.md` — `artwork@v1` capability + ArtworkService.
- `plan/architecture-home-skeleton-layout-1.md` — preceding skeleton layout plan referenced by the home feed design.
- `CLAUDE.md` — project rules: vp toolchain, shared package rules, changesets.
- Better Auth session cookie cache documentation — config shape used in TASK-029.

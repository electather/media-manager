---
goal: Thread compose deadline through home + media leaves to stop warm-job per-row timeouts
version: 1.0
date_created: 2026-05-23
last_updated: 2026-05-23
owner: Omid Astaraki
status: 'Completed'
tags: [feature, server, home, media, jobs, bug]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Implement PR 8 (`home-deadline-propagation`) per rev 6 of `docs/2026-05-05-home-page-backend-design.md`. Diagnostics surfaced a per-row timeout on `host.home.layout_warm` (`runId d43fccf3-461e-4fc3-8918-5c5d4f13ad1a`) because `ctx.deadlineMs` is set at compose entry but dropped by every leaf under `enrichItems` and ignored as a clip on per-plugin `defaultTimeoutMs`. Worst-case plugin call ≈ 32 s; sequential compose phases compound past the 60 s per-row cap. This plan threads `deadlineMs` through every leaf, clips per-plugin `timeoutMs` to remaining budget, reshapes hero soft-failure to per-pool, and gives the warm job a 45 s compose budget with 15 s SQLite writeback slack.

## 1. Requirements & Constraints

- **REQ-001**: `buildContext` reshapes to `buildContext(userId, logger?, opts?: { deadlineMs?: number })`. Default `deadlineMs = Date.now() + 8_000` when not provided. HTTP procedures continue passing no opts.
- **REQ-002**: `host.home.layout_warm` handler sets `deadlineMs = Date.now() + 45_000` when calling `buildContext`.
- **REQ-003**: `invokeWithTimeout` clips its own timer to `min(req.timeoutMs, req.deadlineMs − Date.now())` when `req.deadlineMs` is set. When remaining ≤ `50ms`, return a synthetic outcome `{ pluginId, connectionId, shared, error: { code: "plugin.timeout", devMessage: "deadline_exceeded" } }` without arming a timer.
- **REQ-004**: `StatusBatchMemo.get(ids, opts?: { deadlineMs?: number })` forwards `deadlineMs` into the underlying `mediaRequest@v1.getStatusBatch` dispatch.
- **REQ-005**: `ArtworkService.getArtwork(requests, opts?: { deadlineMs?: number })` forwards `deadlineMs` into its `dispatchAggregatePerKind` request. Pass-through only — the per-kind strategy already plumbs `req.deadlineMs` into `invokeOne`.
- **REQ-006**: `MediaService.getMatchingServers(tmdbId, mediaType, opts?: { deadlineMs?: number })` accepts deadline, forwards into dispatcher.
- **REQ-007**: `MediaService.getShowSeasons(tmdbId, opts?: { deadlineMs?: number })` accepts deadline, forwards into dispatcher.
- **REQ-008**: `MediaService.getMetadata(tmdbId, mediaType, opts?: { deadlineMs?: number })` accepts deadline, forwards into dispatcher.
- **REQ-009**: `enrichItems` reads `ctx.deadlineMs` and passes it into every leaf above. Per-item availability errors caught locally so a single failure does not collapse the batch.
- **REQ-010**: `resolveHero` in `apps/server/src/home/service.ts` is replaced with per-pool catches inside `pickHero`. Each `loadPool` call wrapped in its own `.catch` so a single slow source collapses to `[]` instead of nulling the entire hero.
- **REQ-011**: `composeDetails` cold-fill path passes `ctx.deadlineMs` into `mediaService.getMetadata` and its season fetch.
- **REQ-012**: Regression test reproduces the captured diagnostics: warm-job per-row handler with a fake `continueWatching@v1.getContinueWatching` provider that sleeps 90 s while other providers respond < 1 s yields a layout-cache write (partial blob) and no per-row timeout.
- **CON-001**: No wire-shape change. No DB schema or `home_layout_cache.schema_version` bump.
- **CON-002**: Changes confined to `apps/server/src/{home,media,artwork}/...`. No `packages/shared/...` edits.
- **CON-003**: HTTP request semantics unchanged for callers that omit deadline (8 s ctx unchanged); clip applies symmetrically to request + warm paths.
- **CON-004**: Pre-stable repo — no compat shims for the reshaped signatures.
- **GUD-001**: Follow `backend-feature-architecture` skill for server work; module boundaries respected (home → media via barrel; artwork via service constructor unchanged).
- **GUD-002**: Run `vp check` + `vp test` before commit (memory `#9`). One changeset file at `.changeset/<slug>.md` per memory `#11`.
- **PAT-001**: Opts arg pattern: `{ deadlineMs?: number }`. Never positional; matches existing `dispatchAggregatePerKind` shape.
- **PAT-002**: Per-row failure absorption stays at the existing soft-failure boundary (`isRowSoftFailure`). New code throws `AbortError` on deadline; soft-failure path absorbs.

## 2. Implementation Steps

### Implementation Phase 1 — `invokeWithTimeout` deadline clip

- GOAL-001: Make `invokeWithTimeout` honor the caller's deadline as a hard ceiling on its own timer; short-circuit to a synthetic outcome when the remaining budget is effectively zero. Symmetric for HTTP + warm callers.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `apps/server/src/media/service/invoke.ts:78`, modify `invokeWithTimeout`: compute `remaining = req.deadlineMs == null ? Number.POSITIVE_INFINITY : req.deadlineMs - Date.now()`. Set `effectiveMs = Math.max(0, Math.min(req.timeoutMs, remaining))`. Pass `effectiveMs` to `setTimeout` instead of `req.timeoutMs`. When `effectiveMs < 50`, throw a synthetic `Error` with `name = "AbortError"` and `message = "deadline_exceeded"` without arming the timer — `invokeOne` then normalizes to `{ code: "plugin.timeout" }`. | | |
| TASK-002 | Update `invokeWithTimeout` error message template to read `plugin call timed out after ${effectiveMs}ms (cap ${req.timeoutMs}ms)` so debugging surfaces the clip. | | |
| TASK-003 | Add unit test file `apps/server/src/media/__tests__/invoke.deadline-clip.test.ts`. Cases: (a) `deadlineMs` absent → uses `req.timeoutMs`; (b) `deadlineMs - now > timeoutMs` → uses `timeoutMs`; (c) `deadlineMs - now < timeoutMs` → uses remaining; (d) `deadlineMs - now < 50` → synthetic `AbortError`, no timer; (e) deadline-aware backoff path (`deadlineAllowsRetry`) still gated as before. | | |

### Implementation Phase 2 — `buildContext` opts reshape

- GOAL-002: Reshape `buildContext` to accept an optional deadline override without breaking existing HTTP callers.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | In `apps/server/src/home/service.ts:44`, change signature to `buildContext(userId: string, logger: ConsolaInstance = consola, opts: { deadlineMs?: number } = {})`. Default the field assignment to `opts.deadlineMs ?? Date.now() + DEFAULT_DEADLINE_MS`. Constant `DEFAULT_DEADLINE_MS` unchanged at `8000`. | | |
| TASK-005 | Update `apps/server/src/home/jobs/layout-warm.ts:75` handler: replace `const ctx = buildContext(row.userId, consola)` with `const ctx = buildContext(row.userId, consola, { deadlineMs: Date.now() + WARM_COMPOSE_BUDGET_MS })`. Define `const WARM_COMPOSE_BUDGET_MS = 45_000` near the existing `PER_ROW_TIMEOUT_SEC` constant. | | |
| TASK-006 | Update any other internal callers of `buildContext` (search `grep -rn "buildContext(" apps/server/src/home`). HTTP procedures keep the no-opts call. | | |
| TASK-007 | Existing `composeLayout` cached-blob short-circuit (`opts.forceFresh === false` + `repo.isFresh(cached)`) is unaffected — runs before any deadline-sensitive work. No code change in that branch. | | |

### Implementation Phase 3 — Media service leaves accept `deadlineMs`

- GOAL-003: Extend `MediaService.getMatchingServers`, `getShowSeasons`, `getMetadata` to accept an opts object and forward `deadlineMs` into the underlying dispatcher request. Where the method currently has zero opts, add a `{ deadlineMs? }` arg; where it already has opts, extend the type.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | In `apps/server/src/media/service/index.ts`, locate `getMatchingServers`. Add second parameter `opts: { deadlineMs?: number } = {}`. Pass `deadlineMs: opts.deadlineMs` into the dispatch request alongside `timeoutMs: capability.defaultTimeoutMs`. | | |
| TASK-009 | In the same file, locate `getShowSeasons`. Add `opts: { deadlineMs?: number } = {}`. Forward into dispatch request. Memoization key remains keyed by `(tmdbId, userId)` only — deadline is not part of cache identity. | | |
| TASK-010 | In the same file, locate `getMetadata`. Add `opts: { deadlineMs?: number } = {}`. Forward into dispatch request. | | |
| TASK-011 | Update existing per-request cache keys / memoization: ensure new opts arg does not enter the cache key. | | |
| TASK-012 | Update `apps/server/src/media/__tests__/get-show-seasons.test.ts`, `get-matching-servers.test.ts` (if present) to cover the opts pass-through: assert dispatch request receives `deadlineMs` when set. | | |

### Implementation Phase 4 — Status batch + artwork accept `deadlineMs`

- GOAL-004: Plumb `deadlineMs` through the two compose leaves that build their own dispatch requests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | In `apps/server/src/home/internal/status-batch.ts`, update `StatusBatchMemo.get(ids, opts?: { deadlineMs?: number })`. Forward `deadlineMs` into the `mediaRequest@v1.getStatusBatch` dispatch call. Per-request memoization unchanged. | | |
| TASK-014 | In `apps/server/src/artwork/service.ts`, update `ArtworkService.getArtwork(requests, opts?: { deadlineMs?: number })`. Forward `deadlineMs` into the `dispatchAggregatePerKind` request alongside the existing `timeoutMs` field. Internal `artwork@v1` adapter strategy already forwards `req.deadlineMs` to `invokeOne` — no change there. | | |
| TASK-015 | Update `ArtworkService` constructor signature only if needed to capture `deadlineMs` via call sites; prefer keeping ctor unchanged and threading via method arg. | | |

### Implementation Phase 5 — `enrichItems` forwards deadline

- GOAL-005: Read `ctx.deadlineMs` inside `enrichItems` and forward to each leaf. Each per-item leaf catches errors locally so one failure does not collapse the batch.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | In `apps/server/src/home/internal/enrich.ts:30`, change `ctx.statusBatch.get(compositeIds)` to `ctx.statusBatch.get(compositeIds, { deadlineMs: ctx.deadlineMs })`. | | |
| TASK-017 | In `enrich.ts:33`, change `hydrateArtwork(items, metadata, ctx)` to thread `deadlineMs` to the internal `service.getArtwork(requests, { deadlineMs: ctx.deadlineMs })` call (helper signature stays — pass through). | | |
| TASK-018 | In `enrich.ts:122`, change `ctx.mediaService.getMatchingServers(item.tmdbId, item.mediaType)` to `ctx.mediaService.getMatchingServers(item.tmdbId, item.mediaType, { deadlineMs: ctx.deadlineMs })`. `.catch(() => [])` retained. | | |
| TASK-019 | Confirm the existing per-item `Promise.all` already swallows availability errors. No new try/catch required around `deriveAvailability`. | | |

### Implementation Phase 6 — Per-pool hero soft-failure

- GOAL-006: Replace `resolveHero`'s blanket `.catch(() => null)` with per-pool catches so a single slow source can no longer null the whole hero. Aligns with rev 4 degenerate-fill intent (ship < 6 slides).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | In `apps/server/src/home/service.ts:112`, delete `resolveHero` and inline the call as `pickHero(ctx).catch((err) => { ctx.logger.warn(...); return null; })`. Keep the outer fallback because `pickHero` may still throw on programmer errors. | | |
| TASK-021 | In `apps/server/src/home/internal/hero.ts:61`, wrap each `loadPool(src, ctx)` call passed into the outer `Promise.all` with `.catch((err) => { ctx.logger.warn("[home:hero] pool ${src} threw", err); return []; })`. Mixer + backfill draw from remaining pools when one collapses. | | |
| TASK-022 | Ensure `enrichItems` call inside `pickHero` is itself wrapped: if it throws on a deadline-exceeded artwork hydrate, return a hero composed of `ordered` items with placeholder enrichment OR return `null`. Decision: catch and return `null` — partial layout writeback still happens, hero just renders empty. | | |
| TASK-023 | `composeDetails` cold-fill: pass `ctx.deadlineMs` into `ctx.mediaService.getMetadata(tmdbId, mediaType, { deadlineMs: ctx.deadlineMs })` at `apps/server/src/home/service.ts:255`. Also pass into the `getShowSeasons` call at line 274. | | |

### Implementation Phase 7 — Regression + new tests

- GOAL-007: Add the diagnostics-bug regression test and unit-level coverage for new opts surfaces. Update existing tests broken by the signature reshapes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | Create `apps/server/src/home/__tests__/layout-warm.deadline.test.ts`. Use `vi.useFakeTimers()` + a registered fake `continueWatching@v1.getContinueWatching` provider that returns a never-resolving promise (or sleeps 90 s under fake clock). Other providers (`metadata`, `mediaRequest`, etc.) resolve under 1 s. Invoke the warm handler for one user. Assert: `layoutCache.write` called exactly once with a blob shaped `{ hero, rows, generatedAt }`; CW row dropped or has `partial: true`; no thrown error from the handler; no `cron.job_failed` diagnostics capture. | | |
| TASK-025 | Create `apps/server/src/home/__tests__/enrich.deadline.test.ts`. Mock `StatusBatchMemo.get`, `ArtworkService.getArtwork`, `MediaService.getMatchingServers`; assert each receives `{ deadlineMs: <ctx.deadlineMs> }` opts. Add a case where `getMatchingServers` rejects with `AbortError` — per-item availability returns `{ hasAnyServerCopy: false, requestEligible: false, servers: [] }`. | | |
| TASK-026 | Create `apps/server/src/media/__tests__/invoke.deadline-clip.test.ts` (TASK-003 details). | | |
| TASK-027 | Extend `apps/server/src/home/__tests__/orchestrator.test.ts` (or equivalent): verify `composeLayout` invoked with `forceFresh: true, skipWriteback: true` does NOT write back via the detached `void repo.write` branch. | | |
| TASK-028 | Fix any tests that constructed `buildContext` with the old 2-arg signature (search via grep). Add an explicit `{ deadlineMs: Date.now() + 8_000 }` only where the test asserts deadline behavior; otherwise rely on the default. | | |

### Implementation Phase 8 — Verification + ship

- GOAL-008: Run repo checks, write the changeset, open the PR.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | Run `vp check` (format + lint + types). Fix any findings introduced by the signature reshapes. | | |
| TASK-030 | Run `vp test`. All suites pass — including the new regression test. | | |
| TASK-031 | Add changeset `.changeset/home-deadline-propagation.md`. Internal-only — no consumer-facing API change. Frontmatter empty + body empty per memory `#11`. | | |
| TASK-032 | Open PR titled `feat(server): propagate compose deadline through home + media leaves`. Body links the diagnostics `runId`, references rev 6 of `docs/2026-05-05-home-page-backend-design.md`, lists touched files. | | |

## 3. Alternatives

- **ALT-001**: Raise `perRowTimeoutSec` from 60 to 120. Rejected — masks plugin slowness instead of treating it; still blows up under truly hung plugins.
- **ALT-002**: Move warm-job compose into a separate `scheduled_run` job that processes all users sequentially within one 30-min run. Rejected — loses per-user fault isolation; reverts the design intent of `scheduled_per_row`.
- **ALT-003**: Add `AbortController` plumbing to every plugin invoke so abort actually cancels in-flight HTTP. Deferred — current promise-abandonment leaks memory only transiently and `invokeWithTimeout` already races; deeper abort plumbing is a separate effort tracked outside this PR.
- **ALT-004**: Make warm-job override `defaultTimeoutMs` to a smaller value globally. Rejected — surfaces in non-warm callers too and produces noisy plugin failures on the request path.

## 4. Dependencies

- **DEP-001**: PR 7 (`home-hero-mix`) merged. Rev 6 amends rev 4/5 hero structure; per-pool catches require the rev 4 pool-based mixer to already exist.
- **DEP-002**: No external library upgrades. No `packages/shared/*` changes.
- **DEP-003**: Existing `dispatchAggregatePerKind` / `invokeOne` deadline plumbing (already in place; verified against `apps/server/src/media/service/invoke.ts:64-68`).

## 5. Files

- **FILE-001**: `apps/server/src/media/service/invoke.ts` — clip `timeoutMs` to remaining deadline; synthetic outcome on ≤ 50 ms.
- **FILE-002**: `apps/server/src/media/service/index.ts` — `getMatchingServers`, `getShowSeasons`, `getMetadata` accept `{ deadlineMs? }`.
- **FILE-003**: `apps/server/src/home/service.ts` — `buildContext` opts reshape; per-pool hero catches via inlined `pickHero` call; `composeDetails` cold-fill threads deadline.
- **FILE-004**: `apps/server/src/home/jobs/layout-warm.ts` — `WARM_COMPOSE_BUDGET_MS = 45_000`; handler passes deadline to `buildContext`.
- **FILE-005**: `apps/server/src/home/internal/enrich.ts` — leaves receive `deadlineMs`.
- **FILE-006**: `apps/server/src/home/internal/status-batch.ts` — `StatusBatchMemo.get` accepts `{ deadlineMs? }`.
- **FILE-007**: `apps/server/src/home/internal/hero.ts` — per-pool `.catch` in the `Promise.all`.
- **FILE-008**: `apps/server/src/artwork/service.ts` — `getArtwork` accepts `{ deadlineMs? }`.
- **FILE-009**: `apps/server/src/media/__tests__/invoke.deadline-clip.test.ts` — new.
- **FILE-010**: `apps/server/src/home/__tests__/layout-warm.deadline.test.ts` — new.
- **FILE-011**: `apps/server/src/home/__tests__/enrich.deadline.test.ts` — new.
- **FILE-012**: `.changeset/home-deadline-propagation.md` — empty frontmatter + body (internal-only).
- **FILE-013**: `docs/2026-05-05-home-page-backend-design.md` — already amended (rev 6) outside this PR.

## 6. Testing

- **TEST-001**: `invokeWithTimeout` clip arithmetic — no clip when no deadline; clip to remaining when shorter than `defaultTimeoutMs`; synthetic outcome at ≤ 50 ms (TASK-003).
- **TEST-002**: Warm-job 90 s sleep regression — `layoutCache.write` invoked with partial blob, no per-row timeout, no `cron.job_failed` capture (TASK-024). Reproduces diagnostics `runId d43fccf3-461e-4fc3-8918-5c5d4f13ad1a`.
- **TEST-003**: `enrichItems` forwards `deadlineMs` to every leaf and absorbs per-item availability `AbortError` (TASK-025).
- **TEST-004**: Per-pool hero soft-failure — fake `loadPool` for one source rejects; mixer still produces a hero from remaining pools (extend existing `hero.test.ts`).
- **TEST-005**: HTTP path unchanged — request-path `buildContext()` default produces `deadlineMs ≈ now + 8_000` (TASK-028 spot test).
- **TEST-006**: `composeDetails` cold-fill `getMetadata`/`getShowSeasons` invoked with `deadlineMs` (extend orchestrator tests).
- **TEST-007**: Boundary — `vp check` + `vp test` green (TASK-029, TASK-030).

## 7. Risks & Assumptions

- **RISK-001**: Per-pool hero catches mask programmer errors. Mitigated: each catch logs via `ctx.logger.warn` with source label; ops alerts on log volume catches regressions.
- **RISK-002**: 15 s SQLite slack assumes single PK upsert latency stays sub-second. If `home_layout_cache` row count or blob size grows, slack may shrink. Mitigation: R14 in rev 6 covers retuning protocol.
- **RISK-003**: `invokeWithTimeout` ≤ 50 ms short-circuit could incorrectly fire on system-clock drift across NTP step. Acceptable — the result is one synthetic `plugin.timeout` outcome, absorbed by soft-failure.
- **RISK-004**: Existing per-request memoization on `getMatchingServers`/`getShowSeasons` could leak partial responses if deadline aborts mid-call. Existing memo guards with try/finally; verify before TASK-008.
- **ASSUMPTION-001**: `mediaRequest@v1.getStatusBatch`, `libraryAvailability@v1` (via `getMatchingServers`), and `artwork@v1` strategies all already forward `req.deadlineMs` into `invokeOne` — the gap is only at the service-method signature surface, not inside the dispatcher strategies. Verify by reading `apps/server/src/media/internal/strategies/{single,aggregate-per-kind}.ts` before TASK-008.
- **ASSUMPTION-002**: Detached cache writeback path (`opts.skipWriteback === false`) is unreachable from the warm job — warm job sets `skipWriteback: true`. Detached writeback unchanged by this plan.
- **ASSUMPTION-003**: `vp check` covers TypeScript strict-mode unused-arg detection. Adding optional opts args will not fail type checks where callers omit them.

## 8. Related Specifications / Further Reading

- `docs/2026-05-05-home-page-backend-design.md` (rev 6) — amended spec; primary reference.
- `docs/2026-04-20-job-service-design.md` — `scheduled_per_row` job kind, per-row timeout semantics.
- `docs/media-service.md` — `MediaService` dispatcher overview.
- `apps/server/src/media/service/invoke.ts` — existing deadline-aware retry path (`deadlineAllowsRetry`, `handleBackoff`).
- Diagnostics capture (DB) — `runId d43fccf3-461e-4fc3-8918-5c5d4f13ad1a`.

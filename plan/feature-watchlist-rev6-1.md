---
goal: Watchlist sub-page UX fixes + new `unavailable` bucket (rev 6)
version: 1.0
date_created: 2026-05-23
last_updated: 2026-05-23
owner: Omid Astaraki
status: 'In progress'
tags: [feature, bug, frontend, backend, wire, migration]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

**Build pass 2026-05-23:** Phases 1–7 executed. `vp check` clean, `vp test` 2283/2283 pass. TASK-034 (manual dev-server smoke) is the only outstanding row — user-driven verification of the four UX symptoms in the browser.

Execute the rev 6 deltas defined in `docs/2026-05-23-watchlist-sections-design.md` §M Phase 4b. Four concrete UX fixes wrapped in one shipping unit: (1) bucket chip active state must survive `?sort=` flip; (2) per-route Suspense fallback must resemble its content; (3) empty bucket sub-routes must render a shared design-system empty state with bucket-scoped copy; (4) a new `"unavailable"` bucket replaces the previously-hidden `"unknown"` classifier tail, surfacing every active watchlist row under a visible filter chip. Awaiting bucket semantics stay unchanged — it gates on request-provider status (`requested|processing|unavailable`) emitted by seerr-style plugins and is intentionally empty until the user requests a title.

Pre-stable break: `WATCHLIST_BUCKETS` widens from 4 → 5 and `ClassifiedBucket` drops the `"unknown"` tail. No compat shim per CON-001 from the prior backend design.

## 1. Requirements & Constraints

- **REQ-001**: Bucket chip active state derived from `pathname` only. `?sort=`/`?peek=`/future search params ⊥ contribute (V.WL9).
- **REQ-002**: Suspense fallback identity is per-route — flat + mood routes ≡ `WatchlistGridSkeleton`; curated keeps `WatchlistSkeleton` (V.WL10).
- **REQ-003**: Empty bucket sub-route renders `<EmptyState>` primitive with bucket-scoped copy. ⊥ raw `<p>` (V.WL11).
- **REQ-004**: `WATCHLIST_BUCKETS = ["ready", "in-progress", "awaiting", "unavailable", "upcoming"] as const`. Order pinned.
- **REQ-005**: `ClassifiedBucket = WatchlistBucket` exactly. Classifier emits no `"unknown"` value (V.WL2 rev 6).
- **REQ-006**: `WatchlistCounts` adds `unavailable: number`. `total = ready + inProgress + awaiting + unavailable + upcoming`.
- **REQ-007**: New route `/watchlist/unavailable` mirrors other flat bucket routes (same loader, same Suspense + ErrorBoundary placement).
- **REQ-008**: Request-provider status `"unavailable"` (on `WatchlistItem.status`) routes to the **awaiting** bucket via `STATUS_MAP["unavailable"] = "awaiting"`. Distinct from the new bucket `"unavailable"`. No rename.
- **SEC-001**: Endpoint zod schemas reject unknown bucket values (5-wide enum). 400 on mismatch.
- **CON-001**: Pre-stable — no compat shim for old `"unknown"` classifier value or 4-wide `WATCHLIST_BUCKETS`.
- **CON-002**: No new server endpoint. All work flows through existing `/api/watchlist/items`, `/api/watchlist/counts`.
- **CON-003**: `EmptyState` primitive lives at `apps/client/src/shared/components/empty-state/`. Watchlist-specific wrapper stays feature-local. Other features ⊥ touched by this plan (future opt-in adoption).
- **CON-004**: Paraglide keys for empty copy follow `watchlist_empty_<bucket>_{title,description}` shape. Mood reuses `watchlist_empty_mood_{title,description}`.
- **GUD-001**: Per CLAUDE.md frontend-feature-architecture skill — read before editing feature folder.
- **GUD-002**: Per CLAUDE.md — `vp check` + `vp test` clean before commit.
- **PAT-001**: `EmptyState` visual pattern lifted from `apps/client/src/features/settings-apps/components/apps-empty.tsx`.
- **PAT-002**: Changeset file under `.changeset/` per CLAUDE.md — single user-facing `@ent-mcp/client` minor entry; `@ent-mcp/server` empty-frontmatter entry.

## 2. Implementation Steps

### Implementation Phase 1 — Shared wire types

- GOAL-001: Widen `WATCHLIST_BUCKETS` tuple, drop `unknown` from `ClassifiedBucket`, add `unavailable` to `WatchlistCounts`. Single shared-package commit so server + client widen against the same source of truth.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Edit `packages/shared/src/watchlist/enums.ts`: change `WATCHLIST_BUCKETS = ["ready", "in-progress", "awaiting", "upcoming"] as const` → `["ready", "in-progress", "awaiting", "unavailable", "upcoming"] as const`. Order fixed. | ✅ | 2026-05-23 |
| TASK-002 | Edit `packages/shared/src/watchlist/types.ts`: extend `WatchlistCounts` with `unavailable: number`. Order: `ready, inProgress, awaiting, unavailable, upcoming, total`. | ✅ | 2026-05-23 |
| TASK-003 | Verify `packages/shared/src/watchlist/schemas.ts::itemsQuerySchema.bucket` already references `WATCHLIST_BUCKETS` const — no edit needed if so; otherwise update to consume the const. | ✅ | 2026-05-23 |
| TASK-004 | Run `vp check` at repo root — TypeScript surfaces every downstream consumer of `WatchlistBucket` / `WatchlistCounts` that must be updated in subsequent phases. Catalog the failures; they drive Phase 2 + Phase 3. | ✅ | 2026-05-23 |

### Implementation Phase 2 — Server classifier + counts

- GOAL-002: Server emits `"unavailable"` for every row that previously fell through to `"unknown"`. `getCounts` returns the new field. Zero hidden rows.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Edit `apps/server/src/watchlist/classify.ts`: change `export type ClassifiedBucket = WatchlistBucket \| "unknown"` → `export type ClassifiedBucket = WatchlistBucket`. | ✅ | 2026-05-23 |
| TASK-006 | In `apps/server/src/watchlist/classify.ts::classifyBucket`: change final fallthrough `return "unknown"` → `return "unavailable"`. Order of preceding branches unchanged (`in-progress` → `ready` → `STATUS_MAP` → `upcoming` via `facets.releaseDate \|\| isInfoOnly`). | ✅ | 2026-05-23 |
| TASK-007 | Edit `apps/server/src/watchlist/service.ts::getCounts` (~lines 134-180): add `let unavailable = 0` accumulator. Replace the `else if (bucket === "upcoming")` final arm to also branch on `"unavailable"`. Return shape: `{ ready, inProgress, awaiting, unavailable, upcoming, total }`. | ✅ | 2026-05-23 |
| TASK-008 | Audit `apps/server/src/watchlist/tonight/score.ts` line ~49-55 — verify the `bucket ∈ {awaiting, upcoming, unknown}` penalty references `unavailable` not `unknown`. Fix if drift. (Design §S.2 already updated.) | ✅ | 2026-05-23 |
| TASK-009 | Extend `apps/server/src/watchlist/__tests__/service.test.ts`: assert `getCounts` returns `unavailable: number` and `total` equals the sum of 5 visible buckets. Pin rev-6 invariant V.WL2. | ✅ | 2026-05-23 |
| TASK-010 | New test `apps/server/src/watchlist/__tests__/classify.test.ts` (or extend existing): property-based assertion that for every fixture row, `classifyBucket(...)` returns a value in `WATCHLIST_BUCKETS`. Negative: `"unknown"` never emitted. | ✅ | 2026-05-23 |
| TASK-011 | Extend `apps/server/src/api/__tests__/watchlist-routes.test.ts`: validate `/items?bucket=unavailable` returns 200; `/items?bucket=invalid` returns 400. | ✅ | 2026-05-23 |

### Implementation Phase 3 — Shared `EmptyState` primitive

- GOAL-003: Promote the `apps-empty.tsx` visual pattern into a reusable shared primitive. Watchlist + future features compose against it.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Create `apps/client/src/shared/components/empty-state/index.tsx`. Public API: `EmptyState({ icon: ReactNode; title: string; description: string; action?: ReactNode })`. Layout = centered column, `size-11 rounded-lg bg-muted` icon container, `text-sm font-medium text-foreground` title, `text-xs text-muted-foreground` description, optional action slot below. Mirror `apps-empty.tsx` classes. | ✅ | 2026-05-23 |
| TASK-013 | Create `apps/client/src/shared/components/__tests__/empty-state.test.tsx`: render with required props, assert icon/title/description present + ARIA semantics; render with `action` prop, assert action rendered below description. | ✅ | 2026-05-23 |

### Implementation Phase 4 — Client route + chip behavior

- GOAL-004: Add the `unavailable` flat route, regenerate the route tree, fix chip active state and add chip for new bucket.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Create `apps/client/src/routes/_authenticated/_app/watchlist.unavailable.tsx`. Mirror `watchlist.ready.tsx`: same component shell, passes `bucket="unavailable"` to `<WatchlistFlatPage>`. | ✅ | 2026-05-23 |
| TASK-015 | Run TanStack route-tree regeneration (`vp dev` watcher auto-emits, or explicit codegen command). Verify `apps/client/src/routeTree.gen.ts` lists the new route. | ✅ | 2026-05-23 |
| TASK-016 | Edit `apps/client/src/features/watchlist/components/sections/all-items/bucket-chips.tsx`: change every `<Link activeOptions={{ exact: true }}>` to `activeOptions={{ exact: true, includeSearch: false }}`. Two occurrences (the `all` link and the bucket-loop link). | ✅ | 2026-05-23 |
| TASK-017 | Same file: add `"unavailable": m.watchlist_filter_unavailable` to `BUCKET_LABELS`. Add `"unavailable": "unavailable"` to `BUCKET_COUNT`. The `WATCHLIST_BUCKETS.map(...)` loop auto-renders the new chip. TypeScript exhaustiveness will flag missing entries — fix until clean. | ✅ | 2026-05-23 |
| TASK-018 | Audit `apps/client/src/features/watchlist/components/watchlist-header.tsx` for pip totals — if it enumerates buckets in a `Record<WatchlistBucket, …>`, add the `unavailable` entry. If pip totals are a single `counts.total` render, no change. | ✅ | 2026-05-23 |
| TASK-019 | New test `apps/client/src/features/watchlist/__tests__/bucket-chips.test.tsx` (extend if exists): assert chip active class persists when `?sort=alpha` is appended to the URL (V.WL9). Render with route `/watchlist/ready?sort=alpha` and assert the `ready` chip has the active data attribute / `aria-selected="true"`. | ✅ | 2026-05-23 |

### Implementation Phase 5 — Skeleton + empty wiring

- GOAL-005: Replace generic Suspense fallbacks on flat + mood pages with grid-shape skeleton; route empty grids through bucket-aware `<WatchlistEmpty>`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | Create `apps/client/src/features/watchlist/components/sections/all-items/grid-skeleton.tsx`. Export `WatchlistGridSkeleton({ rows?: number; cols?: number })`. Render a CSS grid with `gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))"` and `rows * cols` (default 4×3 = 12) `<Skeleton class="aspect-[2/3] rounded-xl"/>` placeholders. Wrap in a container that matches `VirtualGrid` outer padding. | ✅ | 2026-05-23 |
| TASK-021 | Edit `apps/client/src/features/watchlist/components/watchlist-flat-page.tsx`: replace `<Skeleton className="h-[600px] w-full rounded-2xl" />` with `<WatchlistGridSkeleton />`. Drop the now-unused `Skeleton` import if no other reference remains. | ✅ | 2026-05-23 |
| TASK-022 | Edit `apps/client/src/features/watchlist/components/watchlist-mood-page.tsx`: replace `<Skeleton className="h-150 w-full rounded-2xl" />` with `<WatchlistGridSkeleton />`. Drop unused import. | ✅ | 2026-05-23 |
| TASK-023 | Create `apps/client/src/features/watchlist/components/sections/all-items/empty.tsx`. Export `WatchlistEmpty({ bucket?: WatchlistBucket; mood?: MoodId })`. Resolves icon (lucide) + paraglide copy from a per-bucket `Record<WatchlistBucket, { icon, titleKey, descKey }>` (exhaustive over `WATCHLIST_BUCKETS`). Mood branch picks `watchlist_empty_mood_*` + mood-specific glyph (reuse mood registry icon if available, else `BookmarkIcon`). Composes `<EmptyState>` from Phase 3. | ✅ | 2026-05-23 |
| TASK-024 | Edit `apps/client/src/features/watchlist/components/sections/all-items/index.tsx`: replace `<p className="py-16 text-center text-sm text-muted-foreground">{m.watchlist_empty()}</p>` with `<WatchlistEmpty bucket={bucket} mood={mood} />`. Pass through the props the component already accepts. | ✅ | 2026-05-23 |
| TASK-025 | New test `apps/client/src/features/watchlist/__tests__/grid-skeleton.test.tsx`: assert `WatchlistGridSkeleton` renders N placeholders (default 12) with `aspect-[2/3]`. Render in a router-less environment is fine. | ✅ | 2026-05-23 |
| TASK-026 | New test `apps/client/src/features/watchlist/__tests__/suspense-fallback-identity.test.ts`: import each flat + mood route module (`watchlist.ready`, `watchlist.in-progress`, `watchlist.awaiting`, `watchlist.unavailable`, `watchlist.upcoming`, `watchlist.moods.$moodId`) and assert each `<Suspense>` fallback element identity ≡ `WatchlistGridSkeleton`. Read the JSX via the route component's render tree. V.WL10 anti-drift. | ✅ | 2026-05-23 |
| TASK-027 | Extend `apps/client/src/features/watchlist/__tests__/all-items.test.tsx` (or create): one test row per visible bucket — render `<AllItems>` with empty items array + bucket prop, assert `<EmptyState>` rendered with bucket-specific title. V.WL11. | ✅ | 2026-05-23 |

### Implementation Phase 6 — Paraglide messages

- GOAL-006: Add localized strings for empty-state copy + new chip label. Drop deprecated keys.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | Edit `apps/client/messages/en.json` (or paraglide source file): add keys for each visible bucket: `watchlist_empty_ready_title`, `watchlist_empty_ready_description`, `watchlist_empty_in_progress_title`/`_description`, `watchlist_empty_awaiting_title`/`_description`, `watchlist_empty_unavailable_title`/`_description`, `watchlist_empty_upcoming_title`/`_description`. Add `watchlist_empty_mood_title`, `watchlist_empty_mood_description` (with `{moodLabel}` placeholder). Add `watchlist_filter_unavailable` chip label. Copy from §C.7 table in the design doc. | ✅ | 2026-05-23 |
| TASK-029 | Mirror every key from TASK-028 in `apps/client/messages/fa.json`. Mark translation TODOs if Persian copy isn't ready — paraglide will still build with English fallback. | ✅ | 2026-05-23 |
| TASK-030 | Grep for callers of `m.watchlist_empty(` across `apps/client/src`. If zero remain after Phase 5 wiring, delete the key from en + fa message sources and let paraglide regenerate. | ✅ | 2026-05-23 |
| TASK-031 | Run `vp check` — paraglide regeneration is part of the type pipeline. Confirm new message exports surface in `paraglide/messages/_index.d.ts`. | ✅ | 2026-05-23 |

### Implementation Phase 7 — Cleanup, verification, changeset

- GOAL-007: Validate full build + tests, write changesets, hand off.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-032 | Run `vp lint` — fix any new findings introduced in Phases 1–6. | ✅ | 2026-05-23 |
| TASK-033 | Run `vp test` — full test suite green. Re-run failed tests individually if needed; do not skip. | ✅ | 2026-05-23 |
| TASK-034 | Manually verify in dev (`vp dev`): navigate `/watchlist` → click each bucket chip → flip sort → assert active state persists; assert grid skeleton paints on cold load; assert each empty bucket shows correct copy. Capture the previously-empty awaiting flow + the populated unavailable flow. |  |  |
| TASK-035 | Create `.changeset/<slug>.md`. Body: `@ent-mcp/client: minor — Added an "Unavailable" filter for wishlisted items that aren't on a connected media server. Sub-pages now show a content-shaped loading state and a clearer empty state explaining why a section is empty.` Per CLAUDE.md changeset conventions. | ✅ | 2026-05-23 |
| TASK-036 | Create `.changeset/<slug2>.md` for server with empty frontmatter (internal-only): `---\n---` (no body). Server changes are user-invisible. | ✅ | 2026-05-23 |

## 3. Alternatives

- **ALT-001**: Broaden `awaiting` to include "released + no server" (option B from brainstorming). Rejected — awaiting carries an active fulfillment connotation; folding unrelated state into it muddies the chip semantics and breaks the seerr integration's mental model.
- **ALT-002**: Hide the `awaiting` chip when `counts.awaiting === 0`. Rejected — violates V.WL8 (chip strip auto-includes from `WATCHLIST_BUCKETS`) and trains users to expect chips to disappear, which is worse UX than a clearly-labeled empty state.
- **ALT-003**: Keep `"unknown"` classifier value alongside `"unavailable"` for genuine edge cases (missing metadata). Rejected — adds a 6th hidden state for negligible benefit; rows with missing metadata are rare and `"unavailable"` is a fine catch-all destination for them.
- **ALT-004**: Per-bucket bespoke skeleton (e.g. ready uses 16:9 strip). Rejected — all four flat buckets render the same 2:3 `VirtualGrid`, so divergent skeletons would create false signal.
- **ALT-005**: Watchlist-local empty component, no shared primitive. Rejected — `apps-empty.tsx` already exists as a sibling pattern; promoting it costs little and gives notifications/plugins a clean reuse target.

## 4. Dependencies

- **DEP-001**: `@ent-mcp/shared` workspace package — TASK-001/002/003 changes shared types consumed by both apps.
- **DEP-002**: TanStack Router — `activeOptions.includeSearch` is the API used in TASK-016. Verify version ≥ the release that exposes this option (v1.x current).
- **DEP-003**: Paraglide — message regeneration runs via `vp check`. No new tool dependency.
- **DEP-004**: lucide-react icons used in `WatchlistEmpty` (`PlayCircleIcon`, `PauseCircleIcon`, `ClockIcon`, `PackageOpenIcon`, `CalendarIcon`, `BookmarkIcon`). Already a dependency.
- **DEP-005**: `@/shared/ui/skeleton` — used inside `WatchlistGridSkeleton`. Already present.

## 5. Files

- **FILE-001**: `packages/shared/src/watchlist/enums.ts` — widen `WATCHLIST_BUCKETS`.
- **FILE-002**: `packages/shared/src/watchlist/types.ts` — extend `WatchlistCounts`.
- **FILE-003**: `packages/shared/src/watchlist/schemas.ts` — verify enum reference (likely no edit).
- **FILE-004**: `apps/server/src/watchlist/classify.ts` — drop `"unknown"` from `ClassifiedBucket`; fallthrough → `"unavailable"`.
- **FILE-005**: `apps/server/src/watchlist/service.ts::getCounts` — add `unavailable` tally + return field.
- **FILE-006**: `apps/server/src/watchlist/tonight/score.ts` — audit penalty bucket list.
- **FILE-007**: `apps/server/src/watchlist/__tests__/service.test.ts` — extend counts tests.
- **FILE-008**: `apps/server/src/watchlist/__tests__/classify.test.ts` — new property test for total coverage.
- **FILE-009**: `apps/server/src/api/__tests__/watchlist-routes.test.ts` — extend `/items?bucket=unavailable` happy + 400 invalid.
- **FILE-010**: `apps/client/src/shared/components/empty-state/index.tsx` — new shared primitive.
- **FILE-011**: `apps/client/src/shared/components/__tests__/empty-state.test.tsx` — primitive test.
- **FILE-012**: `apps/client/src/routes/_authenticated/_app/watchlist.unavailable.tsx` — new route.
- **FILE-013**: `apps/client/src/routeTree.gen.ts` — auto-regenerated.
- **FILE-014**: `apps/client/src/features/watchlist/components/sections/all-items/bucket-chips.tsx` — `includeSearch: false` + `unavailable` chip wiring.
- **FILE-015**: `apps/client/src/features/watchlist/components/watchlist-header.tsx` — pip total audit (conditional edit).
- **FILE-016**: `apps/client/src/features/watchlist/components/sections/all-items/grid-skeleton.tsx` — new skeleton.
- **FILE-017**: `apps/client/src/features/watchlist/components/sections/all-items/empty.tsx` — bucket-aware empty wrapper.
- **FILE-018**: `apps/client/src/features/watchlist/components/sections/all-items/index.tsx` — swap inline `<p>` for `<WatchlistEmpty>`.
- **FILE-019**: `apps/client/src/features/watchlist/components/watchlist-flat-page.tsx` — Suspense fallback ≡ `WatchlistGridSkeleton`.
- **FILE-020**: `apps/client/src/features/watchlist/components/watchlist-mood-page.tsx` — Suspense fallback ≡ `WatchlistGridSkeleton`.
- **FILE-021**: `apps/client/messages/en.json` + `apps/client/messages/fa.json` — paraglide message sources for empty copy + chip label; drop unused `watchlist_empty`.
- **FILE-022**: `apps/client/src/features/watchlist/__tests__/bucket-chips.test.tsx` — chip active across sort.
- **FILE-023**: `apps/client/src/features/watchlist/__tests__/grid-skeleton.test.tsx` — placeholder render.
- **FILE-024**: `apps/client/src/features/watchlist/__tests__/suspense-fallback-identity.test.ts` — route Suspense fallback identity (V.WL10 anti-drift).
- **FILE-025**: `apps/client/src/features/watchlist/__tests__/all-items.test.tsx` — bucket-aware empty rows.
- **FILE-026**: `.changeset/<slug>.md` — client minor.
- **FILE-027**: `.changeset/<slug2>.md` — server empty.

## 6. Testing

- **TEST-001**: `classify.test.ts` — every classify output ∈ `WATCHLIST_BUCKETS`; `"unknown"` never emitted (V.WL2 rev 6).
- **TEST-002**: `service.test.ts::getCounts` — `unavailable` field returned; `total === ready + inProgress + awaiting + unavailable + upcoming`.
- **TEST-003**: `watchlist-routes.test.ts` — `/items?bucket=unavailable` 200 happy; `/items?bucket=junk` 400.
- **TEST-004**: `empty-state.test.tsx` — primitive renders icon/title/description; action slot conditional.
- **TEST-005**: `bucket-chips.test.tsx` — chip active class persists across `?sort=alpha` and `?sort=runtime` (V.WL9).
- **TEST-006**: `grid-skeleton.test.tsx` — N placeholders rendered, `aspect-[2/3]` class present, CSS grid columns set.
- **TEST-007**: `suspense-fallback-identity.test.ts` — each route module's Suspense fallback ≡ `WatchlistGridSkeleton` (V.WL10).
- **TEST-008**: `all-items.test.tsx` — one row per bucket: empty items renders `<EmptyState>` with bucket-specific title (V.WL11).

## 7. Risks & Assumptions

- **RISK-001**: Route-tree regeneration (TASK-015) may require a running `vp dev` or explicit codegen step in this repo. Mitigation: if the tree doesn't auto-emit, fall back to running the TanStack codegen command explicitly; verify `routeTree.gen.ts` contains the new route before proceeding.
- **RISK-002**: Pre-stable break — any external consumer of the `ClassifiedBucket = "unknown"` literal will break. Mitigation: `grep -rn '"unknown"' packages/plugins packages/plugin-sdk` before merging; per CON-001 no shim is added if hits are workspace-only.
- **RISK-003**: `WatchlistEmpty` icon mapping for mood detail relies on the mood registry — if `MOOD_REGISTRY` does not currently expose an icon, fall back to `BookmarkIcon` and file a follow-up to extend the registry. Do not block this plan.
- **RISK-004**: `WatchlistGridSkeleton` default count (12) may visually under-fill on ultra-wide viewports. Acceptable since skeleton is transient (sub-second on warm fetch); revisit if perf telemetry says otherwise.
- **RISK-005**: Persian translations for new empty-state copy may not be ready at ship — paraglide falls back to English. Coordinate with the translator after merge; the strings are non-blocking.
- **ASSUMPTION-001**: Most rows the user already sees as "wishlisted but unavailable" classify as `unknown` today (78 of 87 in the probed account). They will surface under the new `unavailable` chip on first load.
- **ASSUMPTION-002**: No request-provider plugin currently emits `processing` or `requested` status for this user's rows; awaiting bucket will remain empty post-ship until a seerr-like flow runs. Empty-state copy explains this.
- **ASSUMPTION-003**: `bucket-chips.tsx` is the only call site for the bucket `<Link>` strip. Header pip totals (if any) are a separate render path; audit per TASK-018.

## 8. Related Specifications / Further Reading

- `docs/2026-05-23-watchlist-sections-design.md` rev 6 (this plan implements §M Phase 4b).
- `docs/2026-05-19-watchlist-backend-design.md` (parent backend spec, classifier origin).
- `apps/client/src/features/settings-apps/components/apps-empty.tsx` (PAT-001 source).
- CLAUDE.md — frontend-feature-architecture skill, changeset conventions, vp toolchain rules.
- TanStack Router `<Link activeOptions>` docs — `includeSearch` flag behavior.

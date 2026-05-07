---
goal: Reshape home hero from single-source cascade to mixed-source slides (Amendment 3 / rev 4)
version: 1.0
date_created: 2026-05-07
last_updated: 2026-05-07
owner: Omid Astaraki
status: 'Planned'
tags: [feature, refactor, wire-shape, home, ui]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implements PR 7 (`home-hero-mix`) of the home page backend design — Amendment 3 (rev 4) in [docs/2026-05-05-home-page-backend-design.md](../docs/2026-05-05-home-page-backend-design.md). Replaces the single-source `pickHero` cascade with a mixed-source composer that draws a fixed quota across all four sources (continueWatching, recommendedForYou, trendingNow, newReleases), backfills short slots by priority, and orders slides cascade-lead-then-interleave. Reshapes `LayoutHero` from `{ item, source, reason, resumeUrl, alternates }` to `{ slides: HeroSlide[] }`. Bumps `home_layout_cache.schema_version` 1 → 2. Updates client to iterate slides[] with per-slide source labels.

Single PR. Stacks on already-merged home backend (PRs 1-6 of original phase plan). No compat shim — pre-stable per project memory.

## 1. Requirements & Constraints

- **REQ-001**: Hero ships exactly 6 slides when supply is sufficient across all sources.
- **REQ-002**: Quota per source: `continueWatching` × 1, `recommendedForYou` × 2, `trendingNow` × 2, `newReleases` × 1 (= 6 total).
- **REQ-003**: Backfill cascade priority: `[continueWatching, recommendedForYou, trendingNow, newReleases]`. Short slots are filled by walking pools in this order, taking the next unused candidate per pass, repeating until target reached or all pools exhausted.
- **REQ-004**: Slide ordering: lead = first non-empty source by priority; remainder = round-robin interleave by priority over what is left after lead pulled.
- **REQ-005**: Each `HeroSlide` carries its own `source` (RowKind) + `reason` (HeroReason) + `resumeUrl` (string | null).
- **REQ-006**: `LayoutHero` returns `null` only when every source is empty (full cascade exhaustion).
- **REQ-007**: Within hero, `${source}:${tmdbId}` keys are unique by construction (backfill skips already-used keys).
- **REQ-008**: No dedup against rows below the hero; same item may appear in hero and its source row.
- **REQ-009**: `enrichItems` runs once across all final slide items (status, availability, facets, matchReason).
- **REQ-010**: `slide.resumeUrl` is always `null` v1 (plugin SDK has no `playback@v1.getResumeUrl` method); UI Play button = nav-to-detail.
- **CON-001**: `home_layout_cache.schema_version` bump from 1 → 2 invalidates every existing row on first deploy. `layoutCache.read` discards version-mismatched blobs and falls through to live recompose.
- **CON-002**: Pre-stable project — no transitional union or compat shim on `LayoutHero`. Client narrows to slides[] in same PR.
- **CON-003**: Pool size cap per source = 6 candidates (gives backfill headroom without unbounded fetches).
- **CON-004**: Capability gating preserved — `loadContinueWatchingPool` returns `[]` when `hasCapabilityProvider("continueWatching", "v1", "user")` is false.
- **GUD-001**: Use `es-toolkit` for `orderBy` / `groupBy` (already used in `home/hero.ts`); do not add `lodash` or hand-roll equivalents.
- **GUD-002**: Per-slide source label mapping lives in client `top-zone/source-label.ts` (new file). Maps `RowKind` → existing Paraglide message key (e.g. `continueWatching` → `home_row_continueWatching_header`).
- **PAT-001**: Each per-source pool loader stamps `{ source, reason, resumeUrl }` on every slide it returns; the composer never needs to re-derive these.
- **PAT-002**: Composer functions (`loadPool`, `drawByQuota`, `backfill`, `orderCascadeLeadInterleave`) are pure modules of `home/hero.ts` — no separate files. `pickHero` orchestrates.

## 2. Implementation Steps

### Implementation Phase 1 — Shared wire reshape

- GOAL-001: Reshape `LayoutHero` in `@ent-mcp/shared/home` to a slides-based contract; type compiles across the workspace.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In [packages/shared/src/home/types.ts](../packages/shared/src/home/types.ts) replace the existing `LayoutHero` interface (lines 115-130) with `HeroSlide` + `LayoutHero { slides: HeroSlide[] }` per §Wire shape of Amendment 3. Drop `item`, `source`, `reason`, `resumeUrl`, `alternates` from `LayoutHero`. Keep `HomeLayoutResponse.hero` as `LayoutHero | null`. | | |
| TASK-002 | Document `HeroSlide` and `LayoutHero.slides` with JSDoc covering: per-slide source/reason/resumeUrl semantics; `slides[0]` is the lead/auto-shown; `null` LayoutHero only on every-source-empty. Drop the existing `alternates` JSDoc (lines 119-128). | | |
| TASK-003 | Run `vp check` from repo root; expect type errors in `apps/server/src/home/hero.ts`, `apps/client/src/features/home/components/home-feed.tsx`, `apps/client/src/features/home/components/top-zone/index.tsx`, `apps/client/src/features/home/lib/types.ts`. These are the call-sites Phases 2 + 4 + 5 will fix. | | |

### Implementation Phase 2 — Server hero composer rewrite

- GOAL-002: Replace `pickHero` cascade in `apps/server/src/home/hero.ts` with mixed-source composer (loadPool/drawByQuota/backfill/orderCascadeLeadInterleave). Hero unit tests cover quota, backfill, ordering, degenerate fill, and pool stamping.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | In [apps/server/src/home/hero.ts](../apps/server/src/home/hero.ts) add module constants: `const HERO_TARGET = 6;` `const POOL_SIZE = 6;` `const QUOTA: Record<RowKind, number> = { continueWatching: 1, recommendedForYou: 2, trendingNow: 2, newReleases: 1 };` `const PRIORITY: RowKind[] = ["continueWatching", "recommendedForYou", "trendingNow", "newReleases"];` Keep existing `FINISHING_THRESHOLD = 0.85`. Remove `HERO_POOL = 5`. | | |
| TASK-005 | Add internal type `interface HeroSlideInternal { item: InternalCompactMediaItem; source: RowKind; reason: HeroReason; resumeUrl: string \| null; }` Remove the existing `HeroPick` and `CascadeStep` types and the `CASCADE` array constant. | | |
| TASK-006 | Replace `pickContinueWatchingHero` with `loadContinueWatchingPool(ctx)`. Same capability gate (`hasCapabilityProvider("continueWatching","v1","user")` → return `[]` when false), same eligibility filter (progressMs > 0 AND fraction < FINISHING_THRESHOLD), same ordering (`orderBy ... lastPlayedAt desc`). Slice to `POOL_SIZE`, map via `fromContinueWatchingEntry`, drop nulls, then map each item to `{ item, source: "continueWatching", reason: "continue_watching", resumeUrl: null }`. Return `HeroSlideInternal[]`. | | |
| TASK-007 | Replace `pickRecommendedHero` with `loadRecommendedPool(ctx)`. Same `catalog.getRecommendations(userId, "default")` lookup, slice to `POOL_SIZE`, batch-fetch metadata via `catalog.getMetadataBatch`, build slides via `fromCanonicalMetadata(meta, { topContributors: k.topContributors })`. Stamp `{ source: "recommendedForYou", reason: "recommended", resumeUrl: null }`. Skip keys with no metadata hit. | | |
| TASK-008 | Replace `pickTrendingHero` with `loadTrendingPool(ctx)`: call `pickFromDiscover(ctx, "trending", "popularity_desc")` style — refactor `pickFromDiscover` into `loadDiscoverPool(ctx, feedKind, sort, source, reason)` returning `HeroSlideInternal[]` with `source` + `reason` stamped. Slice to `POOL_SIZE`, batch-fetch metadata, drop missing-metadata keys, stamp `{ source: "trendingNow", reason: "trending", resumeUrl: null }`. | | |
| TASK-009 | Replace `pickNewReleaseHero` with `loadNewReleasesPool(ctx)`: same `loadDiscoverPool` helper, `feedKind="newReleases"`, `sort="popularity_desc"`, stamp `{ source: "newReleases", reason: "new_release", resumeUrl: null }`. | | |
| TASK-010 | Add `loadPool(source: RowKind, ctx: RowContext): Promise<HeroSlideInternal[]>` — switch on source dispatching to the four loaders. Pure routing function; no fallback / no capability gate (gates live in the loaders). | | |
| TASK-011 | Add `drawByQuota(poolsByKind: Record<RowKind, HeroSlideInternal[]>, quota: Record<RowKind, number>): HeroSlideInternal[]` — walk `PRIORITY` order, take `min(pool.length, quota[src])` from each, concat. Pure function. | | |
| TASK-012 | Add `backfill(drafts: HeroSlideInternal[], poolsByKind: Record<RowKind, HeroSlideInternal[]>, target: number, priority: RowKind[]): HeroSlideInternal[]` — `used = new Set(drafts.map(s => \`${s.source}:${s.item.tmdbId}\`))`. Loop while `drafts.length < target`: walk priority, find first slide in each pool whose key is not in `used`, push + mark. Set `progressed = false` flag at top of each pass; break outer loop if no pool progressed in a full pass. | | |
| TASK-013 | Add `orderCascadeLeadInterleave(slides: HeroSlideInternal[], priority: RowKind[]): HeroSlideInternal[]` — `groupBy` by `source` (preserves draw order within group). Pull `lead` = `shift()` from first non-empty priority queue; if all empty return slides as-is. Round-robin remainder: while any queue has items, walk priority and `shift()` one per queue per pass. Return `[lead, ...rest]`. | | |
| TASK-014 | Rewrite `pickHero(ctx)`: `pools = await Promise.all(PRIORITY.map(src => loadPool(src, ctx)))` then `poolsByKind = Object.fromEntries(zip(PRIORITY, pools))`. Run `drafts = drawByQuota(poolsByKind, QUOTA)`, `filled = backfill(drafts, poolsByKind, HERO_TARGET, PRIORITY)`. If `filled.length === 0` return `null`. `ordered = orderCascadeLeadInterleave(filled, PRIORITY)`. `enriched = await enrichItems(ordered.map(s => s.item), ctx, { rowId: "hero" })`. Map `slides = ordered.map((s, i) => ({ ...s, item: enriched[i]!, resumeUrl: resolveResumeUrl(s) }))`. Return `{ slides }`. | | |
| TASK-015 | Update `resolveResumeUrl` signature to `resolveResumeUrl(_slide: HeroSlideInternal): string \| null` and keep returning `null`. Inline JSDoc updated to reference R2 + Amendment 3 §Wire shape rationale. | | |
| TASK-016 | In hero.ts top-of-file JSDoc replace cascade-language with mixer-language. Reference Amendment 3 (`docs/2026-05-05-home-page-backend-design.md`). Document quota, backfill, order rules in 5-10 line summary above `pickHero`. | | |
| TASK-017 | Confirm exports of `pickHero` only — remove exports of `pickContinueWatchingHero`, `pickRecommendedHero`, `pickTrendingHero`, `pickNewReleaseHero`, and the previous `HeroPick`/`CascadeStep` symbols. Run `grep -rn "pickContinueWatchingHero\|pickRecommendedHero\|pickTrendingHero\|pickNewReleaseHero" apps packages` to confirm zero callers. | | |
| TASK-018 | Rewrite [apps/server/src/home/__tests__/hero.test.ts](../apps/server/src/home/__tests__/hero.test.ts) per §Tests `hero.test.ts` block of Amendment 3. Cover: (a) full quota mix when all sources populated, (b) empty CW backfilled by recs (priority cascade), (c) only CW populated → ≤4 same-source slides (degenerate fill), (d) only newReleases populated → all-new slides, (e) all empty → null, (f) per-slide source/reason match origin pool, (g) lead from highest-priority non-empty source, (h) body order = round-robin interleave, (i) backfill never duplicates `${source}:${tmdbId}`, (j) every slide.resumeUrl === null. | | |
| TASK-019 | Hero tests reuse existing `row-test-helpers.ts` ctx factories. For deterministic ordering tests, fixtures must populate `lastPlayedAt` (CW), pre-sorted rec list, and discover snap arrays so quota slicing is stable. Document the fixture shape inline at the top of the test file. | | |

### Implementation Phase 3 — Layout cache schema bump

- GOAL-003: Bump `home_layout_cache.schema_version` 1 → 2; existing v1 blobs are discarded on first read; warm job repopulates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | In [apps/server/src/home/layout-cache.ts](../apps/server/src/home/layout-cache.ts) change `CURRENT_SCHEMA_VERSION` constant from `1` to `2`. Update top-of-file JSDoc (line 7) to reference Amendment 3 (rev 4) hero reshape as the trigger for the bump. | | |
| TASK-021 | In [apps/server/src/home/__tests__/layout-cache.test.ts](../apps/server/src/home/__tests__/layout-cache.test.ts) add a regression test: `read` returns `null` when row's `schema_version === 1` (or any value !== `CURRENT_SCHEMA_VERSION`). Existing read-null-on-cold and write-upsert tests stay; only the version-mismatch case needs coverage if not already present. | | |
| TASK-022 | No Drizzle migration is required — `home_layout_cache` table schema is unchanged (only the value of the `schema_version` column written by writes changes). Confirm via `grep schema_version apps/server/src/db/schema/home.ts`. | | |

### Implementation Phase 4 — Client lib types + home-feed mapping

- GOAL-004: Update client `HomeFeedData` and `home-feed.tsx` to consume `LayoutHero.slides` instead of synthesising `HeroItem` from `hero.item + hero.alternates`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | In [apps/client/src/features/home/lib/types.ts](../apps/client/src/features/home/lib/types.ts) replace `export type HeroItem = HomeMediaItem & { alternates: HomeMediaItem[] };` (line 56) with `export type HeroSlideUI = HomeMediaItem & { source: RowKind; reason: HeroReason; resumeUrl: string \| null; };` Add the `RowKind` + `HeroReason` imports from `@ent-mcp/shared/home`. Update `HomeFeedData` (line 81) to `{ heroSlides: HeroSlideUI[]; rows: RowData[] }`. Drop `HeroItem` symbol entirely. | | |
| TASK-024 | In [apps/client/src/features/home/components/home-feed.tsx](../apps/client/src/features/home/components/home-feed.tsx) replace lines 87-89 (`heroItem = layout.hero ? ({ ...layout.hero.item, alternates: layout.hero.alternates } as HeroItem) : null`) with `const heroSlides = layout.hero?.slides.map(toHeroSlideUI) ?? [];` Add the `toHeroSlideUI` adapter that maps `HeroSlide` (shared) → `HeroSlideUI` (client) — flatten slide.item fields, attach source + reason + resumeUrl. Likely lives next to existing `toRowData` adapter. | | |
| TASK-025 | Update line 94 (`<TopZone hero={heroItem} onPeek={...}>`) to `{heroSlides.length > 0 ? <TopZone slides={heroSlides} onPeek={handlePeek} /> : null}`. Drop the `HeroItem` import on line 10. | | |

### Implementation Phase 5 — Top-zone slides[] iteration + per-slide source label

- GOAL-005: `TopZone` iterates `slides[]`, the carousel cycles through them, and each slide renders a per-source label. Hero card receives an active slide and shows `source` chip alongside the existing match-reason copy.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Create new file `apps/client/src/features/home/components/top-zone/source-label.ts`: `export function sourceLabel(source: RowKind): string` returning the existing Paraglide message for that source — `continueWatching` → `m.home_row_continueWatching_header()`, `recommendedForYou` → `m.home_row_recommendedForYou_header()`, `trendingNow` → `m.home_row_trendingNow_header()`, `newReleases` → `m.home_row_newReleases_header()`. Switch is exhaustive — let the type system catch new RowKinds. | | |
| TASK-027 | In [apps/client/src/features/home/components/top-zone/index.tsx](../apps/client/src/features/home/components/top-zone/index.tsx) replace `Props.hero: HeroItem` with `Props.slides: HeroSlideUI[]`. Replace the `candidates = useMemo(() => [hero, ...hero.alternates], [hero])` line (line 113) with `candidates = slides`. The active-index/cycle/dismiss handler logic stays the same; only the candidates source changes. `HeroAlternates` continues to render dots — `slides.length` drives the count. | | |
| TASK-028 | Update aria-label on the section (line 124) from `aria-label={hero.title}` to `aria-label={slides[0]?.title ?? ""}` — gracefully handles the empty-slides edge (the parent already guards this case in TASK-025 but be defensive). | | |
| TASK-029 | Pass active slide's `source` down to `<TopZoneHeroCard>` as a new prop `source: RowKind`. In [apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx](../apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx) add `source` to `Props`. Render a small badge/chip above the title (or inline with the existing match-reason chip) using `sourceLabel(source)`. Visual treatment: reuse existing `card-match-reason.tsx` badge styles for consistency, or inline a `<span class="text-xs uppercase tracking-wide text-muted-foreground">` — pick the closest existing pattern in the codebase. Spec the choice in a JSDoc comment on the new prop. | | |
| TASK-030 | The Play button (line ~135 of `top-zone/index.tsx`, `onPlay={() => onPeek(active.id)}`) stays unchanged — `slide.resumeUrl === null` v1 means nav-to-detail behavior is preserved. Add inline comment referencing R2 / Amendment 3 §Server composition step 6. | | |

### Implementation Phase 6 — Tests + verification

- GOAL-006: All client tests pass against new shape; manual smoke confirms hero shows mixed sources with per-slide labels in the dev server.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Update [apps/client/src/features/home/__tests__/top-zone.test.tsx](../apps/client/src/features/home/__tests__/top-zone.test.tsx). Replace the `HERO: HeroItem` fixture (line 11) with a `SLIDES: HeroSlideUI[]` fixture covering ≥3 slides from ≥2 different sources. Existing tests for cycling, dismissal, alternates dots stay — they now exercise slides[]. Add new test: per-slide source label renders the correct Paraglide message for the active slide. | | |
| TASK-032 | Search for all other test files importing `HeroItem` and update them: `grep -rn "HeroItem" apps/client/src/features/home/`. Each fixture migrates to `HeroSlideUI[]`. | | |
| TASK-033 | Run `vp check` from repo root. Expect zero type errors, zero lint errors. | | |
| TASK-034 | Run `vp test` from repo root. Expect all tests pass: server hero/layout-cache suites, client top-zone/home-feed suites, shared schemas. | | |
| TASK-035 | Manual smoke: `vp dev`, sign in as a user with continue-watching activity, open `/`, confirm: (a) hero shows mixed sources (CW + recs + trending + new), (b) carousel dots count = 6 when all sources populated, (c) per-slide source label updates as the carousel cycles, (d) Play button on a CW slide opens the detail modal (nav-to-detail, no resume URL). | | |
| TASK-036 | Manual smoke (new-user path): create a fresh test user with no CW activity, open `/`, confirm: (a) hero still shows ≤6 slides, (b) lead is from `recommendedForYou` (cascade fallback), (c) no errors thrown when CW pool is empty. | | |

### Implementation Phase 7 — Changeset + final hygiene

- GOAL-007: PR ships with required changeset and clean diff.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-037 | Create `.changeset/home-hero-mix.md` with frontmatter `"@ent-mcp/server": minor` and `"@ent-mcp/client": minor`. Body: one-sentence end-user description, e.g. "The hero now showcases a mix of continue-watching, recommended, trending, and new-release titles instead of repeating one source." Per project rule: end-user voice, past tense, no PR numbers. | | |
| TASK-038 | Run `grep -rn "HeroItem\|hero\.alternates\|hero\.item\b" apps packages` to confirm zero stale references after the reshape. | | |
| TASK-039 | Verify [docs/2026-05-05-home-page-backend-design.md](../docs/2026-05-05-home-page-backend-design.md) is consistent with the implementation: §Hero composition pseudo-code matches `apps/server/src/home/hero.ts` symbol names; §Files rev 4 delta lists every changed/new file in this PR (the doc was updated as part of the brainstorming step but cross-check). | | |
| TASK-040 | Open PR `home-hero-mix` against `main`. PR body uses `.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`. Summary references Amendment 3 of the design doc. Test plan = the manual smoke steps from TASK-035 + TASK-036 + `vp check` + `vp test`. | | |

## 3. Alternatives

- **ALT-001**: Keep cascade, expand each picker to return more alternates. Rejected: still single-source per render; user explicitly asked for mix across sources, not deeper alternates from one source.
- **ALT-002**: Round-robin only (no quota). Rejected: gives equal weight to every source, which over-represents `newReleases` and under-represents the personalised sources (recs). The chosen 1+2+2+1 weighting matches the UX intent of "lean on recommended/trending, sprinkle CW + new".
- **ALT-003**: Weighted random sampling (score-based pool). Rejected: harder to test deterministically and harder for users to reason about. Quota + cascade is simple, predictable, and unit-testable with fixed fixtures.
- **ALT-004**: Per-item source/reason on `CompactMediaItem` (no envelope). Rejected: pollutes the shared item type with hero-only fields. The slide envelope keeps hero-only metadata at the hero layer.
- **ALT-005**: Dedup hero items from the rows below. Rejected: standard streaming-UI pattern is to allow overlap (Netflix, Plex). Adds row-level filter complexity for marginal variety gain.

## 4. Dependencies

- **DEP-001**: Existing home backend (PRs 1-6 of `feature-home-page-backend-1.md`) — already merged.
- **DEP-002**: `es-toolkit` `orderBy` + `groupBy` — already in `apps/server` deps and in use by `home/hero.ts`.
- **DEP-003**: `apps/server/src/home/enrich.ts:enrichItems` — already exists; same surface used by row enrichment.
- **DEP-004**: `apps/server/src/home/adapters.ts:fromContinueWatchingEntry` + `fromCanonicalMetadata` — already exist.
- **DEP-005**: `apps/server/src/catalog/CatalogService` `getRecommendations` + `getMetadataBatch` + `getDiscoverFeed` — already exist.
- **DEP-006**: Existing Paraglide messages: `home_row_continueWatching_header`, `home_row_recommendedForYou_header`, `home_row_trendingNow_header`, `home_row_newReleases_header` — already in `apps/client/messages/home/en.json`.

## 5. Files

- **FILE-001**: [packages/shared/src/home/types.ts](../packages/shared/src/home/types.ts) — reshape `LayoutHero`; add `HeroSlide`.
- **FILE-002**: [apps/server/src/home/hero.ts](../apps/server/src/home/hero.ts) — full rewrite; replace cascade with mixer.
- **FILE-003**: [apps/server/src/home/layout-cache.ts](../apps/server/src/home/layout-cache.ts) — bump `CURRENT_SCHEMA_VERSION` 1 → 2; update JSDoc.
- **FILE-004**: [apps/server/src/home/__tests__/hero.test.ts](../apps/server/src/home/__tests__/hero.test.ts) — rewrite per §Tests block.
- **FILE-005**: [apps/server/src/home/__tests__/layout-cache.test.ts](../apps/server/src/home/__tests__/layout-cache.test.ts) — add version-mismatch regression if not already present.
- **FILE-006**: [apps/client/src/features/home/lib/types.ts](../apps/client/src/features/home/lib/types.ts) — replace `HeroItem` with `HeroSlideUI`; reshape `HomeFeedData`.
- **FILE-007**: [apps/client/src/features/home/components/home-feed.tsx](../apps/client/src/features/home/components/home-feed.tsx) — slides[] mapping; pass `slides` to `<TopZone>`.
- **FILE-008**: [apps/client/src/features/home/components/top-zone/index.tsx](../apps/client/src/features/home/components/top-zone/index.tsx) — `Props.slides`; iterate slides; pass active source to hero card.
- **FILE-009**: [apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx](../apps/client/src/features/home/components/top-zone/top-zone-hero-card.tsx) — accept `source` prop; render per-slide source label.
- **FILE-010**: `apps/client/src/features/home/components/top-zone/source-label.ts` — NEW; maps `RowKind` → existing Paraglide message.
- **FILE-011**: [apps/client/src/features/home/__tests__/top-zone.test.tsx](../apps/client/src/features/home/__tests__/top-zone.test.tsx) — fixtures + assertions migrate to slides[]; add per-slide source label test.
- **FILE-012**: `.changeset/home-hero-mix.md` — NEW; minor bump for `@ent-mcp/server` + `@ent-mcp/client`.

## 6. Testing

- **TEST-001**: `hero.test.ts` — full quota mix (1 CW + 2 rec + 2 trend + 1 new = 6 slides) when all sources populated.
- **TEST-002**: `hero.test.ts` — empty CW: 5 drawn from quota, 1 backfilled from recs (priority cascade order).
- **TEST-003**: `hero.test.ts` — only CW populated: ≤4 same-source slides (degenerate fill case from R12).
- **TEST-004**: `hero.test.ts` — only newReleases populated: ≤6 all-new slides; lead = first new.
- **TEST-005**: `hero.test.ts` — every source empty → `pickHero` returns `null`.
- **TEST-006**: `hero.test.ts` — `slides[i].source` and `slides[i].reason` match origin pool (CW slide → `continue_watching`, rec → `recommended`, trend → `trending`, new → `new_release`).
- **TEST-007**: `hero.test.ts` — lead = first non-empty priority source (CW first when present, else rec, etc.).
- **TEST-008**: `hero.test.ts` — body order = round-robin interleave by priority over remainder after lead.
- **TEST-009**: `hero.test.ts` — backfill never produces duplicate `${source}:${tmdbId}` keys across slides.
- **TEST-010**: `hero.test.ts` — every `slide.resumeUrl === null` v1 (including CW slides — see R2).
- **TEST-011**: `layout-cache.test.ts` — `read` returns `null` when stored row has `schema_version` ≠ `CURRENT_SCHEMA_VERSION`.
- **TEST-012**: `top-zone.test.tsx` — slides[] iteration: 6 slides → 6 alternate dots; clicking dot N sets `activeIndex = N`.
- **TEST-013**: `top-zone.test.tsx` — per-slide source label updates when active slide changes (e.g. dot 0 = "Pick up where you left off", dot 1 = "Recommended for you").
- **TEST-014**: Manual smoke (TASK-035 / TASK-036) — full-user + new-user paths render mixed-source hero; carousel cycles correctly; Play button opens detail modal.

## 7. Risks & Assumptions

- **RISK-001** (R12 in design doc): Degenerate fill — when only one source has supply (typically a brand-new install where only TMDB trending is populated before recs job runs), backfill exhausts the single pool and ships < 6 slides, all same source. Mitigation: tests cover the all-same-source branch; rare in practice once the recs warm job has run once.
- **RISK-002** (R13 in design doc): Schema bump 1 → 2 invalidates every existing `home_layout_cache` row on first deploy. Cost = N active users × one cold compose (≤ 5 s budget per design § Goals). Mitigation: spread by `host.home.layout_warm` jitter on the next hourly tick.
- **RISK-003**: Removing `pickContinueWatchingHero` / `pickRecommendedHero` / `pickTrendingHero` / `pickNewReleaseHero` exports breaks any external caller. Mitigation: TASK-017 grep confirms zero callers before deleting (only `pickHero` is exported via `home/hero.ts`'s public surface; the per-source pickers were never imported elsewhere).
- **RISK-004**: Fan-out cost — `pickHero` now calls `loadPool` four times concurrently (vs the old cascade which short-circuited). Trending + new-releases are catalog snapshot reads (sub-ms PK), CW is a plugin call (already cached), recs is a catalog read. Net: at most one fresh plugin call instead of one cascade probe; warm path identical. Mitigation: `Promise.all` keeps wall-clock equal to slowest pool; `enrichItems` runs once across all final slides (no per-pool enrichment).
- **ASSUMPTION-001**: Per project memory — pre-stable phase, no compat shim required. `LayoutHero` reshape ships in one PR with both server and client narrowed.
- **ASSUMPTION-002** (A9 in design doc): Mixer bypasses the previous per-source picker exports. Verify zero callers via grep before deleting (TASK-017).
- **ASSUMPTION-003**: Existing Paraglide messages `home_row_continueWatching_header` / `home_row_recommendedForYou_header` / `home_row_trendingNow_header` / `home_row_newReleases_header` are appropriate as per-slide source labels. If product wants distinct hero-source labels (e.g. "Continue watching" vs "Pick up where you left off"), add new keys in a follow-up — not a blocker for this PR.
- **ASSUMPTION-004**: Pool size of 6 per source gives sufficient backfill headroom. With quota 1+2+2+1 and worst-case three sources empty, we need at most 6 from one pool — exactly what `POOL_SIZE` provides.

## 8. Related Specifications / Further Reading

- [docs/2026-05-05-home-page-backend-design.md](../docs/2026-05-05-home-page-backend-design.md) — Amendment 3 (rev 4) is the source of truth for this plan.
- [docs/2026-05-04-home-page-implementation-design.md](../docs/2026-05-04-home-page-implementation-design.md) — UI spec for hero/top-zone region.
- [plan/feature-home-page-backend-1.md](feature-home-page-backend-1.md) — original 6-PR rollout that this PR stacks on.
- [plan/feature-home-tv-seasons-1.md](feature-home-tv-seasons-1.md) — sibling Amendment 2 (independent).

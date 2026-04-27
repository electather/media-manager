---
goal: Split getLayout into skeleton + lazy row loading
version: 1.0
date_created: 2026-04-27
status: "Completed"
tags: [architecture, refactor, performance]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

`getLayout` currently fetches all 7 rows (20 items × 7 = 140+ items) on every page load. `getRowContent` already exists for item fetching. This plan splits the endpoint into a fast skeleton (row structure only) and lazy per-row loads, cutting `getLayout` from a 7-row parallel fan-out to one targeted hero fetch.

## 1. Requirements & Constraints

- **REQ-001**: `getLayout` returns row structure (rowId, title, subtitle, titleOverride, initialCursor) with no items.
- **REQ-002**: `getLayout` resolves a hero via one targeted fetch of the hero-candidate row only (limit 1), not all 7 rows.
- **REQ-003**: Hero source row stub receives `initialCursor` set to the cursor returned by the hero fetch (skips the hero item on subsequent scroll). If the hero fetch cursor is null, the row is dropped from stubs.
- **REQ-004**: `becauseYouWatched` initialCursor carries the seed-pinned cursor synthesised from signals (unchanged from today's `buildLayoutOpts` logic).
- **REQ-005**: `getRowContent` accepts `cursor: string | null`; null means first page.
- **REQ-006**: Client fires one `getRowContent` per row immediately after receiving the skeleton. Rows beyond the visible fold fire on scroll.
- **REQ-007**: `upcomingForYou` may return empty items — client shows "You're all caught up" copy (already handled by `EMPTY_RETAINED_COPY` in `row.tsx`; no server-side `ok_empty` exemption needed in the new flow).
- **REQ-008**: Sidebar column (`upcomingForYou`) loads lazily via `useRowPagination` like any other row.
- **CON-001**: `HomeRow` type is preserved unchanged — it is still used as the `getRowContent` response type internally and in `RowContentResponse`.
- **CON-002**: All clean-code rules apply: single-responsibility, no hidden side effects, pure functions stay pure.
- **GUD-001**: Use token savior MCP (`get_function_source`, `get_edit_context`) for targeted reads rather than full-file reads where possible.
- **PAT-001**: New pure functions added to `rules.ts` (no I/O). New async orchestration stays in `layout.ts`. `index.ts` only wires them together.

## 2. Implementation Steps

### Phase 1 — Shared types and schema

- GOAL-001: Add `HomeRowStub`, update `HomeLayoutResponse.rows`, relax cursor schema.

| Task     | Description                                                                                                                                                                                                                                                                                | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-001 | In `packages/shared/src/home/types.ts`: add `HomeRowStub` interface with fields `rowId: RowKind`, `title: string`, `titleOverride?: string`, `subtitle?: string`, `initialCursor: string \| null`, `partial?: true`. Change `HomeLayoutResponse.rows` from `HomeRow[]` to `HomeRowStub[]`. |           |      |
| TASK-002 | In `packages/shared/src/home/schemas.ts`: change `homeGetRowContentInputSchema` cursor field from `z.string().min(1)` to `z.string().nullable()`. Update `HomeGetRowContentInput` inferred type.                                                                                           |           |      |

### Phase 2 — Server: pure rules layer

- GOAL-002: Add signal-driven hero candidate resolver to `rules.ts` (pure, no I/O).

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-003 | In `apps/server/src/home/rules.ts`: add `resolveHeroCandidates(signals: LayoutSignals, order: RowKind[]): RowKind[]`. Returns the subset of `["continueWatching", "recommendedForYou", "trendingNow"]` that are present in `order`, in the same priority order `resolveHero` uses today (continueWatching wins; recommendedForYou only when `profileConfidence` is medium or high; trendingNow last). This drives which row the orchestrator fetches for hero resolution. |           |      |

### Phase 3 — Server: layout pipeline

- GOAL-003: Replace 7-row parallel fan-out with stub builder + single hero fetch.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Completed | Date |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-004 | In `apps/server/src/home/layout.ts`: add pure `buildRowStubs(order: RowKind[], signals: LayoutSignals): HomeRowStub[]`. For each rowId: sets `title` from `ROW_TITLES`, sets `subtitle` for `becauseYouWatched` from `signals.recentSeed.title`, sets `initialCursor` via `buildLayoutOpts` logic (null for most rows, seed-pinned cursor for `becauseYouWatched`). No fetching.                                                                                                                                                        |           |      |
| TASK-005 | In `apps/server/src/home/layout.ts`: add `fetchHero(candidates: RowKind[], ctx: RowFetchContext, signals: LayoutSignals): Promise<{ hero: LayoutHero \| null; heroSource: RowKind \| null; heroCursor: string \| null }>`. Tries each candidate row via `runFetch` with `limit: 1`; stops at first row that returns a non-empty item. Calls `makeHero` (extracted from `resolveHero` in `rules.ts`) to build the `LayoutHero`. Returns `heroCursor` = the cursor from that fetch result (may be null).                                  |           |      |
| TASK-006 | In `apps/server/src/home/layout.ts`: rewrite `runLayoutPipeline`. New flow: (1) `resolveHeroCandidates` to get candidates; (2) `buildRowStubs` to build all stubs; (3) `fetchHero` to resolve hero and `heroCursor`; (4) stamp `titleOverride` from `TITLE_OVERRIDE_MAP` onto hero source stub; (5) stamp `initialCursor = heroCursor` onto hero source stub; (6) if `heroCursor === null` for the hero source row and it had `initialCursor: null` originally, drop that stub (hero consumed the only item). Return `{ hero, stubs }`. |           |      |
| TASK-007 | In `apps/server/src/home/rules.ts`: extract `makeHero` as an exported function (currently private). `fetchHero` in `layout.ts` calls it.                                                                                                                                                                                                                                                                                                                                                                                                |           |      |

### Phase 4 — Server: service and procedure wiring

- GOAL-004: Update `getLayout` response shape; update `getRowContent` to accept nullable cursor.

| Task     | Description                                                                                                                                                                                                                                                                                            | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-008 | In `apps/server/src/home/index.ts`: update `getLayout` to call the rewritten `runLayoutPipeline`, map `stubs` to `HomeRowStub[]`, return `{ hero, rows: stubs, generatedAt }`. Remove `applyDynamicSubtitles` call (subtitles now set in `buildRowStubs`). Remove `toHomeRow` call (no longer needed). |           |      |
| TASK-009 | In `apps/server/src/home/index.ts`: change `getRowContent` args type to `{ rowId: RowKind; cursor: string \| null }`. Pass `cursor` directly to `runFetch` (already accepts `string \| null`). Update `isEligible` call accordingly (already accepts `string \| null`).                                |           |      |

### Phase 5 — Client: pagination hook

- GOAL-005: Remove `initialItems` shortcut; hook always fetches from the server.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-010 | In `apps/client/src/hooks/use-row-pagination.ts`: remove `initialItems` from `UseRowPaginationArgs`. Remove `INITIAL_PAGE_SENTINEL` and its type. Change `initialPageParam` to `initialCursor` (the cursor from the stub, `string \| null`). Remove `initialData` block. `queryFn` always calls `fetchRowPage(rowId, pageParam as string \| null)`. Update `fetchRowPage` signature to `(rowId: RowKind, cursor: string \| null)` and pass `cursor` in the POST body. Update `getNextPageParam` to return `last.cursor ?? undefined`. |           |      |

### Phase 6 — Client: components

- GOAL-006: Thread `HomeRowStub` through the component tree; add per-row loading states.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                         | Completed | Date |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-011 | In `apps/client/src/components/home/row.tsx`: change `RowProps.row` from `HomeRow` to `HomeRowStub`. Update `useRowPagination` call: remove `initialItems`, pass `initialCursor: row.initialCursor`. Add loading branch: when `query.isPending && items.length === 0`, render a `RowSkeleton` (shimmer strip matching `HomeFeedSkeleton` single-row pattern — Skeleton elements inside a flex row). |           |      |
| TASK-012 | In `apps/client/src/components/home/sidebar-column.tsx`: change prop from `HomeRow` to `HomeRowStub`. Replace direct `row.items` access with `useRowPagination({ rowId: row.rowId, initialCursor: row.initialCursor })`. Add loading/empty states.                                                                                                                                                  |           |      |
| TASK-013 | In `apps/client/src/components/home/top-zone.tsx`: change `TopZoneProps.sidebarRow` from `HomeRow \| null` to `HomeRowStub \| null`.                                                                                                                                                                                                                                                                |           |      |
| TASK-014 | In `apps/client/src/components/home/home-feed.tsx`: update all type references from `HomeRow` to `HomeRowStub`. No item-level access exists in this file (only `r.rowId`, `r.titleOverride`, `r.title`) — minimal change.                                                                                                                                                                           |           |      |

### Phase 7 — Tests

- GOAL-007: Update all tests to match the new types and hook interface.

| Task     | Description                                                                                                                                                                                                                                                                                                                                         | Completed | Date |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-015 | In `apps/client/src/hooks/__tests__/use-row-pagination.test.tsx`: remove `initialItems` from all `renderProbe` calls. Add test: "fetches the first page on mount with null cursor". Add test: "fetches the first page on mount with a seed cursor (becauseYouWatched)". Update existing pagination and unavailable tests to mock the initial fetch. |           |      |
| TASK-016 | In `apps/client/src/components/home/__tests__/home-feed.test.tsx`: replace all `HomeRow` mock shapes (with `items` + `cursor`) with `HomeRowStub` shapes (with `initialCursor`). Mock `getRowContent` to return empty items for rows so tests don't hang. Update the `satisfies HomeLayoutResponse` assertions.                                     |           |      |
| TASK-017 | In `apps/client/src/hooks/__tests__/use-home-layout.test.tsx`: update fixture to use `HomeRowStub[]` in layout response.                                                                                                                                                                                                                            |           |      |
| TASK-018 | In `apps/server/src/home/__tests__/layout.test.ts`: update for new `runLayoutPipeline` signature and return shape (`stubs` instead of `rows` with items). Add tests for `buildRowStubs` and `fetchHero`. Update `resolveHero` tests (it still exists in `rules.ts` but is no longer called by the pipeline — keep or remove per test coverage).     |           |      |
| TASK-019 | In `apps/server/src/home/__tests__/home-feed-service.test.ts`: update expected `getLayout` response to `HomeRowStub[]`.                                                                                                                                                                                                                             |           |      |
| TASK-020 | Run `vp check && vp test` to confirm zero errors and full green suite.                                                                                                                                                                                                                                                                              |           |      |

### Phase 8 — Changeset

- GOAL-008: Create changeset and verify CI requirements.

| Task     | Description                                                                                                                                                                                                                                             | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-021 | Create `.changeset/<slug>.md` with `minor` bump for affected public packages. One sentence, end-user language, past tense. Affected packages: `@ent-mcp/client`, `@ent-mcp/server`, `@ent-mcp/plugin-sdk` (if plugin-sdk types change; otherwise omit). |           |      |

## 3. Alternatives

- **ALT-001**: Add a layout-level cache (TTL ~60s per user) without changing the response shape. Rejected: still fetches 140+ items on every cold miss; doesn't enable progressive row loading.
- **ALT-002**: Hero as a separate `getHero` endpoint. Rejected: adds a round trip with no benefit over fetching the hero-candidate row inline in `getLayout`.
- **ALT-003**: Keep `items` in `HomeRowStub` but populate only the hero source row. Rejected: inconsistent shape confuses callers; rows would need special-case logic to detect pre-loaded vs lazy.
- **ALT-004**: Client-side hero item exclusion (filter hero id from row items after load). Rejected: using the cursor returned by the hero fetch as `initialCursor` is stateless and avoids client-side filtering logic.

## 4. Dependencies

- **DEP-001**: `@tanstack/react-query` `useInfiniteQuery` — existing dependency; no version change.
- **DEP-002**: `lru-cache` MemoryCache — unchanged; dispatch-level cache still functions.

## 5. Files

- **FILE-001**: `packages/shared/src/home/types.ts` — add `HomeRowStub`; change `HomeLayoutResponse.rows`
- **FILE-002**: `packages/shared/src/home/schemas.ts` — relax cursor to nullable
- **FILE-003**: `apps/server/src/home/rules.ts` — add `resolveHeroCandidates`, export `makeHero`
- **FILE-004**: `apps/server/src/home/layout.ts` — rewrite pipeline; add `buildRowStubs`, `fetchHero`
- **FILE-005**: `apps/server/src/home/index.ts` — update `getLayout` and `getRowContent`
- **FILE-006**: `apps/client/src/hooks/use-row-pagination.ts` — remove initialItems shortcut
- **FILE-007**: `apps/client/src/components/home/row.tsx` — accept `HomeRowStub`; add per-row skeleton
- **FILE-008**: `apps/client/src/components/home/sidebar-column.tsx` — lazy load via `useRowPagination`
- **FILE-009**: `apps/client/src/components/home/top-zone.tsx` — update prop type
- **FILE-010**: `apps/client/src/components/home/home-feed.tsx` — update type references
- **FILE-011**: `apps/client/src/hooks/__tests__/use-row-pagination.test.tsx` — update tests
- **FILE-012**: `apps/client/src/components/home/__tests__/home-feed.test.tsx` — update fixtures
- **FILE-013**: `apps/client/src/hooks/__tests__/use-home-layout.test.tsx` — update fixture
- **FILE-014**: `apps/server/src/home/__tests__/layout.test.ts` — update for new pipeline
- **FILE-015**: `apps/server/src/home/__tests__/home-feed-service.test.ts` — update expected shape
- **FILE-016**: `.changeset/<slug>.md` — minor bump

## 6. Testing

- **TEST-001**: `buildRowStubs` (pure) — covers: all row kinds; becauseYouWatched gets seed cursor; subtitles set correctly.
- **TEST-002**: `fetchHero` — covers: first candidate wins; fallback when first candidate is empty/fails; returns null when all candidates fail; heroCursor propagated correctly.
- **TEST-003**: `resolveHeroCandidates` — covers: priority order; rfy gated on profile confidence; all three absent returns empty.
- **TEST-004**: `useRowPagination` — covers: initial fetch fires on mount with null cursor; initial fetch fires with seed cursor; pagination appends pages; stops when cursor is null; `onUnavailable` fires on 404.
- **TEST-005**: `HomeFeed` integration — covers: skeleton while pending; empty state; row titles render after layout loads; hero + sidebar renders; sidebar promoted when hero absent.
- **TEST-006**: `Row` — covers: per-row skeleton shown while first page pending; items render after load.

## 7. Risks & Assumptions

- **RISK-001**: Per-row loading increases round-trip count. Mitigated by: client fires visible-row requests immediately after layout; below-fold rows load on scroll.
- **RISK-002**: Hero fetch adds one sequential step before `getLayout` can return. Mitigated: hero fetch is limit=1, typically one plugin call < 200ms on warm cache; signals already ran in parallel.
- **RISK-003**: `upcomingForYou` `ok_empty` state previously required server-side `outcome` tracking. New flow: the client shows "caught up" copy whenever items are empty (already handled by `EMPTY_RETAINED_COPY`), so a timeout or plugin failure would incorrectly show "caught up" copy. Mitigation: `getRowContent` can return a `partial: true` flag on error/timeout; client suppresses `EMPTY_RETAINED_COPY` when `partial` is set. Add this check in TASK-011.
- **ASSUMPTION-001**: All row fetchers handle `cursor: null` as first page (verified: `RowFetchOptions.cursor: string | null` is already the contract).
- **ASSUMPTION-002**: `becauseYouWatched` seed cursor survives round-trip through stub → client → `getRowContent` unchanged (verified: cursor is opaque base64 string, no transport modification).

## 8. Related Specifications / Further Reading

- `apps/server/src/home/rules.ts` — pure layout rules, V9 invariant
- `apps/server/src/home/dataloader.ts` — per-request memoization scope
- `apps/server/src/media/dispatch-cache.ts` — plugin-level cache (unchanged by this plan)
- Design doc §V10: row fetchers cannot reach below `MediaService`
- Design doc §V11: `becauseYouWatched` seed pinned in cursor

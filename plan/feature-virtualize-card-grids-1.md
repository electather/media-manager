---
goal: Virtualize home feed + watchlist card grids with @tanstack/react-virtual
version: 1.0
date_created: 2026-05-21
owner: '@electather'
status: 'Planned'
tags: [feature, performance, client, refactor]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Home + Watchlist render every card on mount. CSS `content-visibility: auto` skips paint but VDOM still scales ∝ N → reconcile jank @ long lists. Replace with `@tanstack/react-virtual` (already in deps `^3.13.24`). Cap DOM ≈ visible+overscan via two new shared primitives (`VirtualWindowList`, `VirtualGrid`) plus a `virtualize` mode on existing `ScrollRowTrack`. Window-vertical scroll stays. Both axes virtualized.

Spec: `docs/2026-05-21-virtualize-card-grids-design.md`.

## 1. Requirements & Constraints

- **REQ-001**: Vertical (window) scroll virtualized on home + watchlist pages.
- **REQ-002**: Horizontal tracks (Row, ReadyRow) virtualized.
- **REQ-003**: Responsive multi-column grids (`Awaiting`, `ComingUp`, `WatchlistFilteredGrid`) virtualized.
- **REQ-004**: Dynamic sizing via `virtualizer.measureElement` — no hard-coded final heights.
- **REQ-005**: Range-based prefetch in horizontal Row: trigger `fetchNextPage` when `endIndex >= items.length - PREFETCH_OFFSET (=4)`; drop existing `usePrefetchObserver`.
- **REQ-006**: Reusable primitives live under new zone `apps/client/src/shared/components/virtualized/`.
- **REQ-007**: `useGridColumns` mirrors CSS `repeat(auto-fill, minmax(min, 1fr))` by computing cols from `clientWidth + gap`.
- **REQ-008**: Window-virt primitives track `parent.offsetTop` as `scrollMargin` via `ResizeObserver(document.body)`.
- **REQ-009**: `watchlist-content`'s `hasNextPage`-driven "Load more" button passes through `VirtualWindowList.footer` prop (non-virtualized trailing slot).
- **REQ-010**: `Row` inline error `<RowErrorInlineCard>` rendered via sentinel item appended to `items`; track `renderItem` switches on sentinel.
- **CON-001**: No new npm dependency (use already-present `@tanstack/react-virtual`).
- **CON-002**: No inner-scroll-container refactor — preserve `min-h-svh` document-scroll in `app-shell.tsx`.
- **CON-003**: Pre-stable; breaking changes inside client OK (no compat shims).
- **CON-004**: Must not regress `apps/client/src/features/notifications/inbox/inbox-list.tsx` (already virtualized — unchanged).
- **CON-005**: Must obey project changeset rule — minor bump `@ent-mcp/client`.
- **GUD-001**: Follow `frontend-feature-architecture` skill conventions; new shared zone gets fallow boundary entry.
- **GUD-002**: Decompose any new file >300 LOC into sub-directory siblings (per memory `feedback_no_double_nest_components`).
- **PAT-001**: Mirror existing virt example `inbox-list.tsx`: `measureElement` ref on absolutely-positioned wrapper; `transform: translateY(start - scrollMargin)`.
- **PAT-002**: All consumers use `<VirtualWindowList>`/`<VirtualGrid>` render-prop style; no direct `useWindowVirtualizer` hook calls in feature code.
- **SEC-001**: No user-supplied HTML injected; primitives accept React children only — no `dangerouslySetInnerHTML`.

## 2. Implementation Steps

### Implementation Phase 1 — Shared primitives

- GOAL-001: Land reusable virtualization primitives + tests in new shared zone. Independently shippable.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `apps/client/src/shared/components/virtualized/use-grid-columns.ts` exporting `useGridColumns(ref, { minColumnWidthPx, gapPx }): { cols: number }`. Implementation: `ResizeObserver(el)` recomputes `cols = Math.max(1, Math.floor((width + gap) / (minColWidth + gap)))`; only triggers `setCols` when value changes. | ✅ | 2026-05-21 |
| TASK-002 | Create `apps/client/src/shared/components/virtualized/virtual-window-list.tsx` exporting `VirtualWindowList<T>` per spec §API. Props: `items`, `getKey`, `estimateSize`, `renderItem`, `overscan?` (d=4), `header?`, `footer?`, `className?`. Uses `useWindowVirtualizer` w/ `scrollMargin` state synced from `parentRef.current.offsetTop` via `ResizeObserver(document.body)`. Renders absolutely-positioned children with `ref={v.measureElement}` and `transform: translateY(vi.start - scrollMargin)`. | ✅ | 2026-05-21 |
| TASK-003 | Create `apps/client/src/shared/components/virtualized/virtual-grid.tsx` exporting `VirtualGrid<T>` per spec §API. Props: `items`, `getKey`, `estimateRowHeight`, `renderItem`, `minColumnWidthPx`, `gapPx?` (d=16), `overscanRows?` (d=2), `className?`, `cellClassName?`. Uses `useGridColumns` then `useWindowVirtualizer({ count: ceil(items.length/cols), getItemKey: r => \`${cols}:${r}\` })`. Each virtual row is a CSS grid w/ `gridTemplateColumns: repeat(cols, minmax(0,1fr))`. | ✅ | 2026-05-21 |
| TASK-004 | Create `apps/client/src/shared/components/virtualized/index.ts` barrel exporting `VirtualWindowList`, `VirtualGrid`, `useGridColumns`. | ✅ | 2026-05-21 |
| TASK-005 | Add fallow zone pair `client-shared-virtualized` to fallow config (`fallow.config.*`). Allowed importers: `client-feat-home`, `client-feat-watchlist`, `client-shared-scroll-row`. Verify with `vp run fallow check`. | ✅ | 2026-05-21 |
| TASK-006 | Create `apps/client/src/shared/components/virtualized/__tests__/use-grid-columns.test.ts`: assert col formula at widths {200, 379, 380, 759, 760}, gap=16, minCol=180 → expected {1,1,2,2,4}. Mock `ResizeObserver` via `vp test` setup. | ✅ | 2026-05-21 |
| TASK-007 | Create `apps/client/src/shared/components/virtualized/__tests__/virtual-window-list.test.tsx`: mock `Element.getBoundingClientRect` + `window.innerHeight=800`, render 200 items @ estimateSize=120, assert `screen.queryAllByTestId('vw-item').length < 20` (visible+overscan cap). | ✅ | 2026-05-21 |
| TASK-008 | Create `apps/client/src/shared/components/virtualized/__tests__/virtual-grid.test.tsx`: 500 items, minCol=180, viewport=1024px → cols=5, assert mounted rows ≤ 6 (visible + overscanRows=2). Trigger ResizeObserver callback w/ width=600 → cols=3, re-assert. | ✅ | 2026-05-21 |
| TASK-009 | Run `vp check` + `vp test` — primitives green before phase 2. | ✅ | 2026-05-21 |

### Implementation Phase 2 — `ScrollRowTrack` virtualize mode

- GOAL-002: Extend existing shared row to support horizontal virtualization without breaking non-virt callers.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Edit `apps/client/src/shared/components/scroll-row.tsx`: add discriminated union to `ScrollRowTrack` props — non-virt branch (existing children behavior) vs `virtualize: true` branch carrying `items`, `getKey`, `estimateItemWidth`, `renderItem`, `overscan?` (d=4), `onRangeChange?`. | ✅ | 2026-05-21 |
| TASK-011 | In virtualize branch: `useVirtualizer({ horizontal: true, count: items.length, getScrollElement: () => trackRef.current, estimateSize: () => estimateItemWidth, overscan })`. Track ref must also call `setViewport(el)` from `useScrollRow()` ctx so chevron buttons + edge-fade still work. | ✅ | 2026-05-21 |
| TASK-012 | Render: `<ul>` becomes `position: relative` (override flex via `data-virt="true"` attr + CSS rule appended to `scroll-row.tsx`'s class string). Total-size spacer `<li aria-hidden style={{ inlineSize: v.getTotalSize() }}>` keeps scroll length. Each visible item: `position: absolute; inset-block-start: 0; inset-inline-start: vi.start; width: var(--card-w)`. `ref={v.measureElement}`. | ✅ | 2026-05-21 |
| TASK-013 | Fire `onRangeChange({ startIndex, endIndex })` from `useEffect([virtualItems])` when range changes. | ✅ | 2026-05-21 |
| TASK-014 | Add CSS override: `[data-slot="scroll-row-track"][data-virt="true"] { display: block; position: relative; }` — keep existing snap/overflow classes. | ✅ | 2026-05-21 |
| TASK-015 | Add unit test `apps/client/src/shared/components/__tests__/scroll-row.test.tsx` (new file): non-virt branch renders children verbatim (regression guard); virt branch caps DOM nodes + fires `onRangeChange`. | ✅ | 2026-05-21 |
| TASK-016 | Run `vp check` + `vp test`. | ✅ | 2026-05-21 |

### Implementation Phase 3 — Home migration

- GOAL-003: Virtualize home page vertical stack + horizontal Row tracks; drop intersection-observer prefetch.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | Edit `apps/client/src/features/home/components/home-feed.tsx`: replace `rows.map(row => <Row ...>)` block with `<VirtualWindowList items={rows} getKey={r=>r.id} estimateSize={estimateHomeRowHeight} header={heroSlides.length > 0 ? <TopZone ... /> : null} renderItem={(row) => <Row row={row} watchlist={watchlist} onWatchlistToggle={toggleWatchlist} onCardClick={handlePeek} />} />`. | ✅ | 2026-05-21 |
| TASK-018 | Add `estimateHomeRowHeight(row)` in `apps/client/src/features/home/lib/home-feed-config.ts`: returns `80 + (row.defaultAspect==='16/9' ? 180 : 300) + 48 + 40`. Export const. | ✅ | 2026-05-21 |
| TASK-019 | Edit `apps/client/src/features/home/components/row/index.tsx`: replace inner `<ScrollRowTrack>{items.map(...)}</ScrollRowTrack>` with `<ScrollRowTrack virtualize items={renderItems} getKey={it => it.id} estimateItemWidth={isBackdrop ? 320 : 200} renderItem={(it, i) => isErrorSentinel(it) ? <RowErrorInlineCard error={error} onRetry={...} isRetrying={isFetchingNextPage} /> : <Card item={it} rowKind={row.kind} isInWatchlist={watchlist?.has(it.id) ?? false} onWatchlistToggle={onWatchlistToggle} onClick={onCardClick} />} onRangeChange={handleRange} />`. `renderItems` = `showInlineError ? [...items, ERROR_SENTINEL] : items`. | ✅ | 2026-05-21 |
| TASK-020 | Implement `handleRange` in `row/index.tsx`: `({endIndex}) => { if (endIndex >= items.length - PREFETCH_OFFSET && hasNextPage && !isFetchingNextPage && items.length > 0) void fetchNextPage(); }`. Memoize. | ✅ | 2026-05-21 |
| TASK-021 | Delete `apps/client/src/features/home/components/row/use-prefetch-observer.ts` and its import in `row/index.tsx`. Remove `attachTrack` / `attachPrefetch` wiring. Track ref no longer needs external attach (ScrollRowTrack manages it). | ✅ | 2026-05-21 |
| TASK-022 | Keep skeleton path: when `showSkeletons`, render non-virtualized `<ScrollRowTrack>` (no `virtualize` prop) with `SKELETON_COUNT` `<ScrollRowSkeleton>` children. Branch in JSX. | ✅ | 2026-05-21 |
| TASK-023 | Update `apps/client/src/features/home/__tests__/row.test.tsx`: add DOM-cap assertion (mount fixture w/ 100 items → mounted Card count ≤ 16). Update existing assertions if they depend on all items being in DOM. | ✅ | 2026-05-21 |
| TASK-024 | Delete `apps/client/src/features/home/__tests__/use-prefetch-observer*.test.*` if present. Add new test in `row.test.tsx`: range-cross fires `fetchNextPage` once. | ✅ | 2026-05-21 |
| TASK-025 | Run `vp check` + `vp test`. | ✅ | 2026-05-21 |

### Implementation Phase 4 — Watchlist migration

- GOAL-004: Virtualize watchlist sections + grids; preserve filtered mode + Load more button.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Add `SECTION_HEIGHT_PX` const to `apps/client/src/features/watchlist/lib/` (new file `section-heights.ts`): `{ 'tonight-pick': 340, 'ready-row': 420, 'mood-mosaic': 560, 'coming-up': 360, 'awaiting': 480, 'recently-added': 320 }`. Export. | ✅ | 2026-05-21 |
| TASK-027 | Refactor `apps/client/src/features/watchlist/components/watchlist-content.tsx`: build `sections: Array<{ kind: SectionKind, node: ReactNode }>` array conditionally based on each component's empty-check. Render `<VirtualWindowList items={sections} getKey={s=>s.kind} estimateSize={i => SECTION_HEIGHT_PX[sections[i].kind]} renderItem={s => s.node} footer={hasNextPage ? <LoadMoreButton ... /> : null} />` when `!filterActive`. | ✅ | 2026-05-21 |
| TASK-028 | In filtered mode (`filterActive`): replace direct `<WatchlistFilteredGrid>` render w/ `<VirtualWindowList items={[{kind:'filtered-grid', node:<WatchlistFilteredGrid ... />}]} ... footer={...same load-more...} />`. Or simpler: render `<WatchlistFilteredGrid>` directly — the inner `VirtualGrid` provides the virtualization, no outer window-list needed. Pick simpler. | ✅ | 2026-05-21 |
| TASK-029 | Edit `apps/client/src/features/watchlist/components/watchlist-filtered-grid.tsx`: replace inner `<div className="grid">{items.map(...)}</div>` with `<VirtualGrid items={items} getKey={it=>it.id} minColumnWidthPx={180} estimateRowHeight={() => 320} renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />} />`. Keep `<SectionHead>` outside. | ✅ | 2026-05-21 |
| TASK-030 | Edit `apps/client/src/features/watchlist/components/awaiting.tsx`: replace grid block w/ `<VirtualGrid items={items} getKey={it=>it.id} minColumnWidthPx={180} estimateRowHeight={() => 320} renderItem={(it) => <div className="opacity-90 transition-opacity hover:opacity-100"><WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} /></div>} className="rounded-2xl border border-dashed border-input bg-card/40 p-5" />`. Move existing `backgroundImage` style to wrapper className/style. | ✅ | 2026-05-21 |
| TASK-031 | Edit `apps/client/src/features/watchlist/components/coming-up.tsx`: replace grid block w/ `<VirtualGrid items={items} getKey={it=>it.id} minColumnWidthPx={220} estimateRowHeight={() => 200} renderItem={(it) => <WatchlistCard item={it} forceAspect="16/9" onPeek={onPeek} />} />`. | ✅ | 2026-05-21 |
| TASK-032 | Edit `apps/client/src/features/watchlist/components/ready-row.tsx`: convert inner `<ScrollRowTrack>` to virtualize mode — `<ScrollRowTrack virtualize items={items} getKey={it=>it.id} estimateItemWidth={200} renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />} />`. | ✅ | 2026-05-21 |
| TASK-033 | Add new test `apps/client/src/features/watchlist/__tests__/watchlist-filtered-grid.test.tsx`: render 200 items @ 1024px viewport, assert DOM-mounted `WatchlistCard` ≤ ~30 (5 cols × visible+overscan rows). | ✅ | 2026-05-21 |
| TASK-034 | Add new test `apps/client/src/features/watchlist/__tests__/awaiting.test.tsx`: same DOM-cap assertion. | ✅ | 2026-05-21 |
| TASK-035 | Update existing watchlist tests if any assert "all items rendered". | ✅ | 2026-05-21 |
| TASK-036 | Run `vp check` + `vp test`. | ✅ | 2026-05-21 |

### Implementation Phase 5 — Wrap-up

- GOAL-005: Changeset, PR docs, ship.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-037 | Create `.changeset/virtualize-card-grids.md` — frontmatter `"@ent-mcp/client": minor`, body: "Virtualized home feed and watchlist card grids so scrolling stays smooth on long lists." | | |
| TASK-038 | Run `vp check && vp test` at repo root one final time. Fix any newly surfaced lint/format issues. | | |
| TASK-039 | Manual smoke: `vp dev`, scroll home (≥3 rows full of cards), scroll watchlist (filtered mode + default mode), verify no jank, no console errors, resize browser to confirm grid col recomputes. | | |
| TASK-040 | Update PR description w/ spec link + plan link + screenshots/gifs of smooth scroll if available. | | |

## 3. Alternatives

- **ALT-001**: Per-component inline `useVirtualizer` hook setups (no shared primitives). Rejected — duplicates 6+ near-identical hook calls, fails "Reuse pattern" success criterion.
- **ALT-002**: CSS-only via tuning `content-visibility` + `contain-intrinsic-size`. Rejected — does NOT cap DOM nodes, only paint; user explicitly chose TanStack route.
- **ALT-003**: Inner-scroll-container refactor (replace document-scroll with `overflow-y-auto` wrapper). Rejected — larger blast radius, breaks sticky top-nav/bottom-nav assumptions, not required.
- **ALT-004**: Fixed-breakpoint column count (sm/md/lg) instead of `ResizeObserver + auto-fill`. Rejected — mismatches existing CSS `auto-fill` behavior, wastes rows near breakpoint edges.

## 4. Dependencies

- **DEP-001**: `@tanstack/react-virtual` `^3.13.24` — already declared in `apps/client/package.json`. No upgrade required for this PR.
- **DEP-002**: Browser `ResizeObserver` API — universally available in target browsers; jsdom mock provided in test setup.
- **DEP-003**: Existing `useIsomorphicLayoutEffect` import path — confirm at impl time (likely React's `useLayoutEffect` re-export or a project shim).

## 5. Files

- **FILE-001**: `apps/client/src/shared/components/virtualized/virtual-window-list.tsx` — NEW. Window-virtualized vertical list primitive.
- **FILE-002**: `apps/client/src/shared/components/virtualized/virtual-grid.tsx` — NEW. Responsive multi-column window-virtualized grid primitive.
- **FILE-003**: `apps/client/src/shared/components/virtualized/use-grid-columns.ts` — NEW. ResizeObserver-driven column count derivation.
- **FILE-004**: `apps/client/src/shared/components/virtualized/index.ts` — NEW. Barrel.
- **FILE-005**: `apps/client/src/shared/components/scroll-row.tsx` — EDIT. Add discriminated `virtualize` branch to `ScrollRowTrack`.
- **FILE-006**: `apps/client/src/features/home/components/home-feed.tsx` — EDIT. Wrap rows in `VirtualWindowList`.
- **FILE-007**: `apps/client/src/features/home/components/row/index.tsx` — EDIT. Use `ScrollRowTrack virtualize`; range-based prefetch.
- **FILE-008**: `apps/client/src/features/home/components/row/use-prefetch-observer.ts` — DELETE.
- **FILE-009**: `apps/client/src/features/home/lib/home-feed-config.ts` — EDIT. Add `estimateHomeRowHeight`.
- **FILE-010**: `apps/client/src/features/watchlist/components/watchlist-content.tsx` — EDIT. Wrap sections in `VirtualWindowList`; pass Load-more as `footer`.
- **FILE-011**: `apps/client/src/features/watchlist/components/watchlist-filtered-grid.tsx` — EDIT. Inner CSS grid → `VirtualGrid`.
- **FILE-012**: `apps/client/src/features/watchlist/components/awaiting.tsx` — EDIT. Inner CSS grid → `VirtualGrid`.
- **FILE-013**: `apps/client/src/features/watchlist/components/coming-up.tsx` — EDIT. Inner CSS grid → `VirtualGrid`.
- **FILE-014**: `apps/client/src/features/watchlist/components/ready-row.tsx` — EDIT. `ScrollRowTrack` virtualize.
- **FILE-015**: `apps/client/src/features/watchlist/lib/section-heights.ts` — NEW. `SECTION_HEIGHT_PX` const.
- **FILE-016**: `fallow.config.*` — EDIT. Add `client-shared-virtualized` zone pair.
- **FILE-017**: `.changeset/virtualize-card-grids.md` — NEW. Minor bump.
- **FILE-018**: `docs/2026-05-21-virtualize-card-grids-design.md` — REFERENCE (already committed).

## 6. Testing

- **TEST-001**: `use-grid-columns.test.ts` — col formula at boundary widths {200, 379, 380, 759, 760} given gap=16, minCol=180 yields {1,1,2,2,4}.
- **TEST-002**: `virtual-window-list.test.tsx` — 200 items rendered ≤ visible+overscan (< 20 mounted) with `window.innerHeight=800`, `estimateSize=120`.
- **TEST-003**: `virtual-grid.test.tsx` — 500 items @ 1024px → cols=5, mounted rows ≤ 6; ResizeObserver fires w/ width=600 → cols=3.
- **TEST-004**: `scroll-row.test.tsx` (new) — non-virt branch renders all children (regression guard); virt branch caps DOM + fires `onRangeChange`.
- **TEST-005**: `features/home/__tests__/row.test.tsx` — extend: DOM cap ≤ 16 cards w/ 100-item fixture; range-cross fires `fetchNextPage` exactly once.
- **TEST-006**: `features/watchlist/__tests__/watchlist-filtered-grid.test.tsx` (new) — DOM cap ≤ 30 cards w/ 200 items @ 1024px viewport.
- **TEST-007**: `features/watchlist/__tests__/awaiting.test.tsx` (new) — DOM cap assertion.
- **TEST-008**: Existing tests pass unchanged: `home-feed.test`, `card.test`, `top-zone.test`, `inbox-list` virt regression, `use-watchlist-items.test`.

## 7. Risks & Assumptions

- **RISK-001**: jsdom returns 0 for layout sizes → virtualizer renders 0 items in tests. Mitigation: mock `Element.getBoundingClientRect` and set `window.innerWidth/innerHeight` in test setup, or seed `initialMeasurementsCache`. Document the helper once, reuse across virt tests.
- **RISK-002**: Sticky top-nav height changes on resize → `scrollMargin` drift. Mitigation: `ResizeObserver(document.body)` in primitives keeps it synced.
- **RISK-003**: Track CSS flex → block swap on virtualize branch may break edge-fade/chevron CSS. Mitigation: gate via `data-virt="true"` attribute selector, override only `display`/`position`, preserve overflow/snap.
- **RISK-004**: `useEffect([virtualItems])` to fire `onRangeChange` may cause render loops if consumer's handler isn't memoized. Mitigation: doc string requires `useCallback`; tests stress with stable handler.
- **RISK-005**: `WatchlistCard` may rely on grid `<div>` parent styles in `Awaiting` (e.g. `opacity-90 hover:opacity-100`). Mitigation: keep wrapper `<div>` inside `renderItem`.
- **ASSUMPTION-001**: All consumer card components are independently testable React components (no Context required from grid parent).
- **ASSUMPTION-002**: `vp test` (Vitest) supports `ResizeObserver` polyfill or accepts a per-test mock — confirm at TASK-006.
- **ASSUMPTION-003**: `RowData.id` is unique across `layout.rows` — used as `getKey`. Confirm in `@ent-mcp/shared/home` types.
- **ASSUMPTION-004**: Watchlist `useWatchlistItems` returns stable `hasNextPage`/`fetchNextPage` references (React Query) — required for `footer` prop stability.

## 8. Related Specifications / Further Reading

- Spec (this PR): `docs/2026-05-21-virtualize-card-grids-design.md`
- Reference impl: `apps/client/src/features/notifications/inbox/inbox-list.tsx`
- Library docs: <https://tanstack.com/virtual/latest/docs/introduction>
- Frontend feature architecture skill: `frontend-feature-architecture`
- Vercel React perf guidelines skill: `vercel-react-best-practices`

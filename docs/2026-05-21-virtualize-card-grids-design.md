# Virtualize Card Grids — Design

Date: 2026-05-21
Owner: @electather
Status: Draft
Mode: caveman/ultra

## Goal

Home + Watchlist scroll jank @ N cards big. Cause: all cards mount, React reconcile ∝ N, paint cost ∝ N (CSS `content-visibility` skip paint but keep VDOM).

Fix: virtualize both axes w/ `@tanstack/react-virtual` (already dep `^3.13.24`). Cap DOM ≈ visible+overscan. Reuse primitive.

Win:
- smooth scroll @ 100+ cards
- DOM node cap (assertable)
- reusable primitive (future feature grids/rows adopt)

## Non-goals

- view transitions on home/watchlist (admin-only, untouched)
- inbox-list rewrite (already virtualized)
- inner scroll container refactor (stay window-scroll)
- baseline INP measurement (no perf tooling)

## Architecture

new zone `client-shared-virtualized` @ `apps/client/src/shared/components/virtualized/`:

```
virtualized/
  virtual-window-list.tsx  # vert, useWindowVirtualizer
  virtual-grid.tsx         # vert grid, lanes
  use-grid-columns.ts      # ResizeObserver → cols/widthPx
  index.ts
```

`ScrollRow` (`shared/components/scroll-row.tsx`) extend in place. Add `virtualize` prop on `ScrollRowTrack`. Non-virt callers untouched.

fallow boundary: new pair `client-shared-virtualized`. Allowed importers: `client-feat-home`, `client-feat-watchlist`, `client-shared-scroll-row`.

vert = window scroll (`useWindowVirtualizer`). horiz = element scroll inside `ScrollRowTrack` (`useVirtualizer({ horizontal: true })`).

## API — pseudocode

### `<VirtualWindowList>`

```ts
type Props<T> = {
  items: readonly T[]
  getKey: (item: T, i: number) => string
  estimateSize: (i: number) => number    // px
  renderItem: (item: T, i: number) => ReactNode
  overscan?: number                       // d=4
  header?: ReactNode                      // non-virt, rendered above
  className?: string
  // keep N items mounted forever (e.g. peek target). i=index.
  pinIndices?: ReadonlySet<number>
}

fn VirtualWindowList<T>(p) {
  parentRef = useRef<HTMLDivElement>(null)
  parentOffsetRef = useRef(0)              // distance from doc top to virt area

  useIsomorphicLayoutEffect(() => {
    parentOffsetRef.current = parentRef.current?.offsetTop ?? 0
  }, [])

  v = useWindowVirtualizer({
    count: p.items.length,
    estimateSize: p.estimateSize,
    overscan: p.overscan ?? 4,
    scrollMargin: parentOffsetRef.current,
  })

  vis = v.getVirtualItems()
  total = v.getTotalSize()
  pinned = p.pinIndices ?? EMPTY_SET
  visIdx = new Set(vis.map(vi => vi.index))
  extraPins = [...pinned].filter(i => !visIdx.has(i))

  return (
    <div ref={parentRef} className={p.className}>
      {p.header}
      <div style={{ height: total, position:'relative', width:'100%' }}>
        {vis.map(vi =>
          <div
            key={p.getKey(p.items[vi.index], vi.index)}
            data-index={vi.index}
            ref={v.measureElement}
            style={{ position:'absolute', insetInline:0, top:0,
                     transform:`translateY(${vi.start - v.options.scrollMargin}px)` }}
          >
            {p.renderItem(p.items[vi.index], vi.index)}
          </div>
        )}
        {/* pinned-but-off-screen kept mounted hidden so caller refs stay alive */}
        {extraPins.map(i =>
          <div key={`pin-${i}`} aria-hidden style={{ position:'absolute', visibility:'hidden', pointerEvents:'none' }}>
            {p.renderItem(p.items[i], i)}
          </div>
        )}
      </div>
    </div>
  )
}
```

### `<VirtualGrid>`

```ts
type Props<T> = {
  items: readonly T[]
  getKey: (item: T, i: number) => string
  estimateRowHeight: (rowIdx: number, cols: number) => number
  renderItem: (item: T, i: number) => ReactNode
  minColumnWidthPx: number                 // matches CSS minmax(Xpx, 1fr)
  gapPx?: number                            // d=16
  overscanRows?: number                     // d=2
  className?: string
  cellClassName?: string
}

fn VirtualGrid<T>(p) {
  parentRef = useRef<HTMLDivElement>(null)
  parentOffsetRef = useRef(0)

  { cols, cellWidthPx } = useGridColumns(parentRef, {
    minColumnWidthPx: p.minColumnWidthPx,
    gapPx: p.gapPx ?? 16,
  })

  rowCount = Math.ceil(p.items.length / Math.max(cols, 1))

  useIsomorphicLayoutEffect(() => {
    parentOffsetRef.current = parentRef.current?.offsetTop ?? 0
  }, [])

  v = useWindowVirtualizer({
    count: rowCount,
    estimateSize: (r) => p.estimateRowHeight(r, cols),
    overscan: p.overscanRows ?? 2,
    scrollMargin: parentOffsetRef.current,
    // remeasure on cols change. forces fresh measureElement cycle.
    getItemKey: (r) => `${cols}:${r}`,
  })

  vis = v.getVirtualItems()

  return (
    <div ref={parentRef} className={p.className}
         style={{ display:'block' }}>
      <div style={{ height: v.getTotalSize(), position:'relative' }}>
        {vis.map(vr => {
          start = vr.index * cols
          slice = p.items.slice(start, start + cols)
          return (
            <div key={vr.key}
                 data-index={vr.index}
                 ref={v.measureElement}
                 style={{
                   position:'absolute', insetInline:0, top:0,
                   transform:`translateY(${vr.start - v.options.scrollMargin}px)`,
                   display:'grid',
                   gridTemplateColumns:`repeat(${cols}, minmax(0, 1fr))`,
                   gap: p.gapPx ?? 16,
                 }}>
              {slice.map((it, j) =>
                <div key={p.getKey(it, start + j)} className={p.cellClassName}>
                  {p.renderItem(it, start + j)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### `useGridColumns`

```ts
type Args = { minColumnWidthPx: number, gapPx: number }
type Out  = { cols: number, cellWidthPx: number }

fn useGridColumns(ref, { minColumnWidthPx, gapPx }): Out {
  [{cols, cellWidthPx}, set] = useState({ cols: 1, cellWidthPx: minColumnWidthPx })

  useIsomorphicLayoutEffect(() => {
    el = ref.current; if (!el) return
    compute = () => {
      w = el.clientWidth
      // mirror `repeat(auto-fill, minmax(min, 1fr))`
      n = Math.max(1, Math.floor((w + gapPx) / (minColumnWidthPx + gapPx)))
      cw = (w - gapPx * (n - 1)) / n
      set(prev => prev.cols === n && Math.abs(prev.cellWidthPx - cw) < 0.5 ? prev : { cols: n, cellWidthPx: cw })
    }
    compute()
    ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [minColumnWidthPx, gapPx])

  return { cols, cellWidthPx }
}
```

### `ScrollRowTrack` virtualize mode

extension `scroll-row.tsx`:

```ts
type VirtTrackProps<T> = ComponentProps<'ul'> & {
  virtualize: true
  items: readonly T[]
  getKey: (it: T, i: number) => string
  estimateItemWidth: number                 // px, equals --card-w
  renderItem: (it: T, i: number) => ReactNode
  overscan?: number                         // d=4
  onRangeChange?: (r: { startIndex: number, endIndex: number }) => void
  pinIndices?: ReadonlySet<number>
}

fn ScrollRowTrack(p) {
  if (!p.virtualize) return /* existing <ul> impl */;

  { setViewport } = useScrollRow()
  trackRef = useRef<HTMLUListElement | null>(null)
  setRef = (el) => { trackRef.current = el; setViewport(el) }

  v = useVirtualizer({
    horizontal: true,
    count: p.items.length,
    getScrollElement: () => trackRef.current,
    estimateSize: () => p.estimateItemWidth,
    overscan: p.overscan ?? 4,
  })

  vis = v.getVirtualItems()
  useEffect(() => {
    if (vis.length === 0) return
    p.onRangeChange?.({ startIndex: vis[0].index, endIndex: vis[vis.length-1].index })
  }, [vis, p.onRangeChange])

  return (
    <ul ref={setRef} role="list" data-slot="scroll-row-track"
        className={cn(BASE_TRACK_CLASSES, p.className)}>
      <li aria-hidden style={{ inlineSize: v.getTotalSize(), blockSize: 1, flexShrink: 0 }} />
      {vis.map(vi => (
        <li key={p.getKey(p.items[vi.index], vi.index)}
            data-slot="scroll-row-item"
            data-index={vi.index}
            ref={v.measureElement}
            className="shrink-0 snap-start"
            style={{
              position:'absolute', insetBlockStart:0,
              insetInlineStart: vi.start,
              width: 'var(--card-w)',
            }}>
          {p.renderItem(p.items[vi.index], vi.index)}
        </li>
      ))}
    </ul>
  )
}
```

note: track wrap `<ul>` becomes `position: relative` block (override `flex` from existing class) when `virtualize=true`. CSS handled by data attribute selector or class swap.

## Migration — per consumer

| consumer | primitive | sizing | prefetch | notes |
|---|---|---|---|---|
| `features/home/components/home-feed.tsx` rows loop | `VirtualWindowList` | `estimateSize: i => row.defaultAspect==='16/9' ? 320 : 420` (header + card-h + margins) | n/a (each Row paginates internally) | hero `TopZone` stays non-virt as `header` prop |
| `features/home/components/row/index.tsx` track | `<ScrollRowTrack virtualize>` | `estimateItemWidth: isBackdrop ? 320 : 200` | range-based: `onRangeChange` → if `endIndex ≥ items.length - PREFETCH_OFFSET` & `hasNextPage` & !`isFetchingNextPage` → `fetchNextPage()` | drop `use-prefetch-observer.ts` |
| `features/watchlist/components/watchlist-content.tsx` sections | `VirtualWindowList` | per-section estimate table (see below) | n/a | filtered mode swaps render-prop to single-section list of `VirtualGrid` |
| `features/watchlist/components/ready-row.tsx` | `<ScrollRowTrack virtualize>` | `estimateItemWidth: 200` | n/a | |
| `features/watchlist/components/watchlist-filtered-grid.tsx` | `VirtualGrid` | `minColumnWidthPx: 180`, `estimateRowHeight: () => 320` | n/a | |
| `features/watchlist/components/awaiting.tsx` | `VirtualGrid` | `minColumnWidthPx: 180`, `estimateRowHeight: () => 320` | n/a | outer dashed border `<section>` stays — VirtualGrid mounts inside |
| `features/watchlist/components/coming-up.tsx` | `VirtualGrid` | `minColumnWidthPx: 220`, `estimateRowHeight: () => 200` (16/9) | n/a | |
| `recently-added.tsx` | none | n/a | n/a | capped @ MAX_ROWS=5, skip |
| `mood-mosaic.tsx` | none | n/a | n/a | bounded set, skip |
| `tonight-pick.tsx` | none | n/a | n/a | single hero, skip |

### Section estimate table — watchlist

```ts
SECTION_HEIGHT_PX = {
  'tonight-pick':    340,
  'ready-row':       420,   // header + row + scroll bar
  'mood-mosaic':     560,
  'coming-up':       360,
  'awaiting':        480,
  'recently-added':  320,
}
```

initial estimates only — `measureElement` corrects post-layout.

### Home rows estimate

```ts
estimateRowHeight = (row: RowData) => {
  base = 80                       // section head
  card = row.defaultAspect === '16/9' ? 180 : 300
  meta = 48                       // title/sub under card
  margin = 40                     // mb-8
  return base + card + meta + margin
}
```

## Data flow

```
HomeFeed
  layout = useHomeFeed()                              // suspense query
  rows = layout.rows                                  // RowData[]
  <VirtualWindowList
    items={rows} estimateSize={estimateRowHeight}
    header={<TopZone .../>}
    renderItem={(row) => <Row row={row} ... />}
  />

Row (inside virtual window list)
  { items, fetchNextPage, hasNextPage } = useHomeRow(row.id)
  <ScrollRow>
    <SectionHead/>
    <ScrollRowViewport>
      <ScrollRowTrack
        virtualize
        items={items}
        estimateItemWidth={isBackdrop ? 320 : 200}
        renderItem={(it) => <Card item={it} .../>}
        onRangeChange={({endIndex}) =>
          endIndex >= items.length - PREFETCH_OFFSET && hasNextPage && !isFetchingNextPage
            ? fetchNextPage() : null
        }
      />
    </ScrollRowViewport>
  </ScrollRow>

WatchlistContent (filterActive=false)
  sections = [
    { kind:'tonight-pick', node: <TonightPick ../> },
    { kind:'ready-row',    node: <ReadyRow ../> },
    ...
  ]
  <VirtualWindowList
    items={sections} estimateSize={i => SECTION_HEIGHT_PX[sections[i].kind]}
    renderItem={(s) => s.node}
  />

WatchlistContent (filterActive=true)
  <VirtualGrid
    items={filtered} minColumnWidthPx={180}
    estimateRowHeight={() => 320}
    renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={...} />}
  />
```

## Sizing strategy

- estimates per-kind (tables above)
- `measureElement` ref on every absolutely-positioned wrapper → auto-correct after first paint
- on resize → ResizeObserver in VirtualGrid recomputes cols; virtualizer remeasures via `getItemKey` change
- `scrollMargin` set to parent `offsetTop` so window-virt accounts for sticky header / hero zone

## Prefetch

- drop `apps/client/src/features/home/components/row/use-prefetch-observer.ts`
- range-based check in `Row.onRangeChange`:
  ```
  if (endIndex >= items.length - PREFETCH_OFFSET && hasNextPage && !isFetchingNextPage)
    fetchNextPage()
  ```
- `PREFETCH_OFFSET = 4` (current constant kept)
- guards: ignore until `items.length > 0`

## Error / loading

- skeletons: `VirtualWindowList` rendered with synthetic skeleton items when `isLoading && items.length===0` (caller responsibility)
- `Row` skeleton path unchanged — track receives skeleton array sized `SKELETON_COUNT`, no virt while skeleton
- `RowError` / `RowErrorInlineCard` unchanged; inline error appended as extra non-virt `<li>` in track via existing slot (re-renders inside virtualize branch via `pinIndices` analog — see below)
- inline error trailing item: simplest — when `showInlineError`, append a "virtual" extra index `items.length` returning `<RowErrorInlineCard>` and treat estimateItemWidth same. Cleaner than DOM-pinning.

## DOM cap — assertion

```ts
test('row caps mounted cards @ overscan*2 + visible', async () => {
  render(<Row row={hugeRow} />)        // 500 items
  await screen.findAllByTestId('home-card')
  // overscan=4, viewport ~ 6 cards visible → ≤ ~14 mounted
  cards = screen.queryAllByTestId('home-card')
  expect(cards.length).toBeLessThan(20)
})
```

## Tests — new

- `virtualized/__tests__/virtual-window-list.test.tsx`: mount 200 items, assert ≤ overscan+visible rendered; scroll → window stays bounded
- `virtualized/__tests__/virtual-grid.test.tsx`: ResizeObserver mock, assert cols recompute on width change; bounded DOM
- `virtualized/__tests__/use-grid-columns.test.ts`: formula correctness at boundary widths
- `features/home/__tests__/row.test.tsx`: extend — assert virtualize cap; assert `fetchNextPage` fires on range cross
- `features/watchlist/__tests__/filtered-grid.test.tsx` (new): cap + scroll
- existing tests: update fixtures where strict child-count assertions exist

## Tests — preserve

- inbox-list virt remains unchanged
- existing `top-zone`, `card`, `home-feed` tests: keep, may need to set window size in jsdom (`window.innerHeight = 800`) to ensure visible window exercises range

## Risks

| risk | mitigation |
|---|---|
| jsdom layout = 0 → virtualizer renders 0 items in tests | set `window.innerWidth/Height` + `Element.getBoundingClientRect` mock in test setup, or use `initialMeasurementsCache` from tanstack to seed |
| sticky header offset wrong on resize | `scrollMargin` re-read on resize via existing `useIsomorphicLayoutEffect` w/ ResizeObserver on parent |
| nested scroll: window vert + element horiz → over-scroll trap | already handled by `overscroll-x-contain` in track CSS; preserve |
| flex-track styles break when switching to absolute children | gate via `data-virt="true"` selector + CSS override |
| INP regression from `measureElement` re-renders | overscan tuned (4 vert, 4 horiz, 2 rows); measure only `vis` set |
| keyboard nav: tab to card outside virtual range | acceptable — landed via `pinIndices` if future need (peek mod stays open via separate portal already) |

## Rollout

single PR. no flag (pre-stable, breaking-change tolerance ok per memory `project_breaking_changes_ok`).

PR sequence (commits):
1. `feat(client): add virtualized shared primitives` — new zone, VirtualWindowList, VirtualGrid, useGridColumns, tests
2. `feat(client): scroll-row virtualize mode` — extend ScrollRowTrack
3. `refactor(home): virtualize feed rows + horizontal tracks` — HomeFeed + Row migration; delete use-prefetch-observer
4. `refactor(watchlist): virtualize sections + grids` — WatchlistContent + Awaiting/ComingUp/FilteredGrid/ReadyRow
5. `chore: changeset` — `.changeset/virtualize-card-grids.md`, minor bump `@ent-mcp/client`

## Changeset draft

```md
---
"@ent-mcp/client": minor
---

Virtualized home feed and watchlist card grids so scrolling stays smooth on long lists.
```

## Open

- exact `estimateItemWidth` per row kind — derive from `BACKDROP_VARS`/`POSTER_VARS` constants in `row/index.tsx` (320 / 200) — confirmed at impl time
- whether to ship a Storybook story for primitives — out of scope (no Storybook configured)

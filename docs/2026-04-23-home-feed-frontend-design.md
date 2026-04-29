# Home Feed — Frontend Design

**Status:** Draft
**Date:** 2026-04-23 (rev 2026-04-29)
**Author:** Omid Astaraki
**Companion:** `2026-04-22-home-feed-design.md` (backend)
**Deps:** `2026-04-22-frontend-plugin-connections-design.md`, `2026-04-19-error-management-design.md`, `2026-04-20-preference-engine-design.md`

## Summary

Netflix-style home. ∀ media surface — hero, upcoming-stack item, row card — = same `Card`. Layout/aspect/treatment auto-derived: nothing passed in to pick variant. `Hero`, `SidebarColumn`, `SidebarItem` ⊥ exist.

Client data layer = TanStack DB on top of RPC. `getRowContent` res → split client-side: per-row ordered entries + global `media` collection. Rows render via live query joining two. Mutations (mark-watched, watchlist) → dedicated endpoints + DB optimistic state.

Backend endpoint shapes unchanged save one additive field (`updatedAt` on `CompactMediaItem`).

`resumeUrl` ⊥ `Card`'s problem. ∀ card click → peek modal. Resume = detail body's job.

Hero never null (server guarantees). Upcoming = optional vertical stack of 3-4, inlined in `getLayout`, not a row.

## Goals

- One component renders ∀ media surface.
- Card adapts to container without consumer telling it.
- Hover anim feels polished, ⊥ gimmicky.
- Mark-watched / watchlist mutations propagate everywhere instantly via DB optimistic state.
- Future Library / Search / Detail reuse same `media` collection.

## Non-goals

- Backend endpoint reshape. Same contracts, one additive field.
- Sync engine (Electric/PowerSync). REST + DB cache for v1.
- Hover-preview card. v2.
- Library / Search / Detail pages. Mentioned only because data model scales there.
- Row-specific user preferences. Server.
- Impression telemetry. Per PreferenceEngine spec.

## Stack

- TanStack Router. File-based routes under `packages/client/src/routes/`.
- React + TS, Vite.
- shadcn/ui, `lucide-react`.
- RPC client.
- **TanStack DB** (`@tanstack/db`) — reactive client store. Wraps RPC via `queryCollectionOptions`.
- `embla-carousel-react` for row horizontal scroll.
- Shared types from `@ent-mcp/shared/home`.
- Tailwind container queries (`@tailwindcss/container-queries`).

Dashboard shell already exists.

## Route + entry

- **Route:** `/` = home. Login lands here. File: `routes/_authenticated/index.tsx`.
- **Detail deep link:** `routes/_authenticated/media.$id.tsx`. Matches `/media/movie:550` & `/media/tv:1396`. Zod on `params` (`^(movie|tv):\d+$`) → invalid `$id` = framework error boundary.
- **Sidebar nav:** "Home", `lucide-react` `Home` icon, above Connections + Taste.
- **Page title:** ⊥ visible `h1`. Browser tab via TanStack Router meta: `"Home · {App}"`.
- **Auth:** inherited from `_authenticated`.

## Wire-type changes (additive only)

```
CompactMediaItem += updatedAt: ISO8601
HomeLayoutResponse.hero: never null     # was nullable
HomeLayoutResponse.upcoming?: {
  items: CompactMediaItem[]             # 3-4, inlined
  showMoreLink?: string                 # /upcoming or similar
}
```

`updatedAt` enables last-write-wins on `media` collection. Server stamps on every entity emit.

`hero` non-null = server picks something always (continueWatching, watchNext, trending fallback). "hero null" branch dies in frontend.

`upcoming` = inlined, ⊥ a row, no pagination. If absent → no upcoming column. Server decides count + showMoreLink presence.

## Client data layer (TanStack DB)

Three collections. Live queries join.

```
mediaCollection = createCollection({
  schema: CompactMediaItem,
  getKey: (item) => item.id,            # MediaId, e.g. "movie:550"
  conflict: lastWriteWins(updatedAt),
})

rowEntriesCollection = createCollection({
  schema: RowEntry { rowId, position, mediaId, score, matchReason? },
  getKey: (e) => `${e.rowId}:${e.position}`,
})

progressCollection = createCollection({
  schema: Progress { mediaId, secondsLeft, watchedCount, totalCount, updatedAt },
  getKey: (p) => p.mediaId,
})
```

### Splitting `getRowContent` res client-side

```
onRowContentSuccess(rowId, page):
  for (i, item) in page.items:
    mediaCollection.upsert(item)        # by id, lastWriteWins on updatedAt
    rowEntriesCollection.insert({ rowId, position: nextPos++, mediaId: item.id, score: item.score, matchReason: item.matchReason })
  cursor[rowId] = page.cursor
```

`getLayout.upcoming.items` + layout-pinned hero same treatment: items → `mediaCollection`. Hero stored as separate ref `layoutHero = { mediaId, source }`. Upcoming items → `rowEntriesCollection` under synthetic rowId `"upcoming"` for live-query symmetry.

### Live query (Row render)

```
useLiveQuery(q =>
  q.from({ row: rowEntriesCollection })
   .where(eq(row.rowId, props.rowId))
   .innerJoin({ media: mediaCollection }, on(row.mediaId, media.id))
   .leftJoin({ prog: progressCollection }, on(row.mediaId, prog.mediaId))
   .orderBy(row.position)
   .select({ ...media, progress: prog })
)
```

Sub-ms re-render on entity update. Mark-watched on one item → flickers across ∀ rows displaying it, ⊥ refetch.

### Mutations

Dedicated RPC endpoints. ∀ wrap with `createOptimisticAction`:

- `media.markWatched(mediaId)`
- `media.markUnwatched(mediaId)`
- `media.addToWatchlist(mediaId)`
- `media.removeFromWatchlist(mediaId)`
- `media.requestAvailable(mediaId)` (Seerr passthrough)

```
markWatched = createOptimisticAction({
  onMutate: (id) => {
    mediaCollection.update(id, m => { m.watchedAt = now(); m.progress = null })
    progressCollection.delete(id)
  },
  mutationFn: (id) => rpc.media.markWatched({ mediaId: id }),
})
```

Failure → DB auto-rollback. UI ⊥ knows.

### Why ⊥ entity-shaped endpoints

Considered: backend returns `{ entries: [{mediaId, position, score}], cursor }`, client fetches entities via `media.byIds`. Rejected: 2 roundtrips/row first paint, server-side ranking already row-shaped, `getRowContent` res naturally carries entity data. Client-side split = same wire bytes, full DB benefits.

## Card model

Three knobs, ∀ derived. Nothing passed in to pick variant.

### Layout — container query

- **Vertical** (default): image top, metadata below.
- **Horizontal-thumb**: small image left, metadata stacked right. When container narrow+tall.

Trigger: `@container (max-width: var(--card-thumb-threshold))`. Threshold = CSS var, single source. Start `320px`.

### Aspect — item shape + container

Backdrop (16:9) when ANY:

- `progress != null` (progress + still img > poster)
- item is layout hero (`item.id === layoutHero.mediaId`)
- horizontal-thumb layout (16:9 reads better in wide-short thumb)

Else: poster (2:3).

Aspect logic ⊥ leak out. No `aspectRatio` prop. No `ROW_DISPLAY` lookup. `<Card item={...} />` figures it.

### Treatment — item shape

- `progress != null` → **continue-watching**: progress bar pinned to bottom edge of img. "Xmin left" + "X/X watched" captions side-by-side directly below img. Both ∀ time.
- `episode != null && progress == null` → **upcoming**: episode line ("S2 E4") + relative date ("Tomorrow", "In 5 days", "Thursday 12 May") under title.
- neither → **default**: title + year + optional status pill + optional rating badge.

### `clearLogo`

When backdrop mode AND `item.clearLogo != null`: render `<img>` bottom-right, inside img frame, on top of backdrop. ⊥ size gating, ⊥ hero-only. Sizes scale w/ container (max 30% of img width).

### Card pseudocode

```
Card({ item }):
  treatment = item.progress ? "cw" : item.episode ? "upc" : "default"
  isHero = item.id === layoutHero?.mediaId
  isThumb = container < 320px              # via @container
  aspect = (item.progress || isHero || isThumb) ? "16/9" : "2/3"

  return (
    <a href={`/media/${item.id}`} onClick={openPeek}>
      <Frame aspect={aspect} layout={isThumb ? "horiz" : "vert"}>
        <Image src={item.image[aspect]} />
        {aspect === "16/9" && item.clearLogo && <ClearLogo src={item.clearLogo} />}
        {treatment === "cw" && <ProgressBar value={item.progress} />}
        <StatusPill if={item.status} />
        <RatingBadge if={item.userRating} />
      </Frame>
      <Meta>
        <Title>{item.title}</Title>
        {treatment === "cw" && <CaptionRow><Left>{minLeft}</Left><Right>{watched}/{total}</Right></CaptionRow>}
        {treatment === "upc" && <UpcomingLine>{episode} · {relDate}</UpcomingLine>}
        {treatment === "default" && <Year>{item.year}</Year>}
        <MatchReason if={item.matchReason && container >= 240px} />
      </Meta>
    </a>
  )
```

Click ∀ paths → peek modal. ⊥ resumeUrl branch. Detail body owns resume.

### Shared rules

- Imgs `loading="lazy"` + `decoding="async"`. ⊥ blur-up.
- ∀ cards = `<a href={`/media/${item.id}`}>`. Middle-click / Cmd-click / "Open in new tab" work natively. Click handler `preventDefault` + writes `peek` search param.
- `StatusPill`, `RatingBadge`, `MatchReason` = sub-components. Shared.

## Hover anim

Default (vertical layout):

- Img scales `1.0 → 1.05` inside fixed frame, `250ms ease-out`. Frame ⊥ move, neighbors ⊥ shift.
- Ring fades in: `1px solid var(--color-border-strong)`, `200ms`.
- Title brightens: `--color-text-secondary → --color-text-primary`, `150ms`.
- Cursor `pointer`.

Horizontal-thumb variant:

- Skip img zoom (img too small, looks weird).
- Background `--color-bg-subtle`, `200ms`.
- Ring + title brighten same.

`prefers-reduced-motion`:

- Kill ∀ transitions.
- Keep ring + brightness changes (instant, ⊥ animated).

⊥ proposed: outer scale (overlap neighbors), translateY lift (gimmicky on grids), info reveal / overview fade-in (= v2 hover-preview).

## Top zone

Always rendered. Hero never null.

CSS Grid. Template swaps based on Upcoming presence:

```
.top-zone {
  display: grid;
  gap: 16px;
}

.top-zone:has(.upcoming) {
  grid-template-columns: 1fr minmax(280px, 360px);
}

.top-zone:not(:has(.upcoming)) {
  grid-template-columns: 1fr;
}

@container (max-width: 768px) {
  .top-zone { grid-template-columns: 1fr !important; }
  .upcoming { /* renders below hero */ }
}
```

Hero cell = `<Card item={layoutHero} />`. Card auto-picks backdrop + continue-watching/default treatment from item.

Upcoming cell = `<UpcomingStack items={layout.upcoming.items} showMoreLink={layout.upcoming.showMoreLink} />`. Vertical flex of `<Card>` instances. Container is narrow → cards auto-pick horizontal-thumb layout via container query. ⊥ pagination. Conditional "Show more →" rendered when `showMoreLink` present.

At `<md` (mobile): grid collapses 1 col. Upcoming stacks below hero. Cards inside Upcoming inherit narrower container → still horizontal-thumb (or vertical if container exceeds thumb threshold).

## Row

Horizontal carousel. Always. ⊥ fluid. One job.

- `embla-carousel-react`, config: `dragFree: true, containScroll: "trimSnaps", slidesToScroll: "auto", align: "start", loop: false`.
- Arrows: hidden at rest, revealed on row-hover or focus-within. ⊥ rendered on `(hover: none)`. `Previous` disabled at scroll start. `Next` disabled when end + cursor null.
- Keyboard: arrows out of Tab order. Cards in Tab. `ArrowLeft`/`ArrowRight` on focused card → moves focus + scrolls. Arrows SR-discoverable via role/label.
- Pagination: scroll progress ≥ 75% + cursor ≠ null + ⊥ in flight → `useRowPagination.fetchNext()`. Loading: skeleton card at end. Failure: silent drop.

## Component tree

```
HomeFeedPage
├── HomeFeedSkeleton
├── HomeFeedEmpty
├── HomeFeedError
└── HomeFeedContent
    ├── TopZone                         # CSS Grid, hero always, upcoming optional
    │   ├── Card item={layoutHero}      # hero cell
    │   └── UpcomingStack?              # if layout.upcoming
    │       ├── Card[] item={...}       # 3-4, container narrow → horiz-thumb
    │       └── ShowMoreLink?           # if showMoreLink
    └── Row[]                           # ∀ rows from layout
        ├── RowHeader                   # title + partial indicator
        └── RowCarousel
            └── Card[] item={...}       # vertical, mix of poster/backdrop per item shape

MediaDetailModal                        # at _authenticated layout level
```

### File layout

```
packages/client/src/
├── routes/_authenticated/
│   ├── index.tsx                       # HomeFeedPage
│   └── media.$id.tsx                   # MediaDetailPage
├── components/home/
│   ├── home-feed.tsx                   # picks skeleton/empty/content/error
│   ├── home-feed-skeleton.tsx
│   ├── home-feed-empty.tsx
│   ├── home-feed-error.tsx             # shares CenteredState w/ empty
│   ├── top-zone.tsx                    # CSS Grid, hero + optional upcoming
│   ├── upcoming-stack.tsx              # vertical flex of Cards + ShowMore
│   ├── row.tsx                         # RowHeader + RowCarousel + pagination
│   ├── row-carousel.tsx                # embla wrapper
│   ├── card.tsx                        # the one
│   ├── progress-bar.tsx                # shared CW component
│   ├── status-pill.tsx
│   ├── rating-badge.tsx
│   ├── match-reason.tsx
│   ├── media-detail-modal.tsx
│   └── media-detail-body.tsx
├── lib/
│   └── collections/
│       ├── media-collection.ts         # global entity store
│       ├── row-entries-collection.ts
│       ├── progress-collection.ts
│       └── mutations.ts                # markWatched, watchlist, etc.
└── hooks/
    ├── use-home-layout.ts              # RPC wrapper, hydrates collections
    ├── use-row-pagination.ts           # RPC wrapper, appends to collections
    └── use-row-items.ts                # live query hook for Row render
```

Dies from prior doc: `hero.tsx`, `sidebar-column.tsx`, `sidebar-item.tsx`, `lib/home-display.ts` (ROW_DISPLAY).

### What lives where

- `index.tsx` thin: `useHomeLayout` → branch (skeleton/empty/content/error) → render. ~40 lines.
- `home-feed.tsx` owns top-level state branch.
- `top-zone.tsx` owns Grid template logic. ⊥ knows about Card internals.
- `upcoming-stack.tsx` owns vertical layout + ShowMore. Children = Cards.
- `row.tsx` owns row-local pagination. ⊥ knows Card treatment.
- `card.tsx` owns ∀ visual logic — layout, aspect, treatment, hover. The one.
- Collections own data shape + reactivity. ⊥ render.
- Mutations live in `lib/collections/mutations.ts`. Imported by detail body, card menus, etc.

### What ⊥ exist

- Generic carousel abstraction. `RowCarousel` specific. Extract if 2nd feature needs.
- Virtualization in row. Caps ~40-60 items. Revisit if `recommendedForYou` grows unbounded.
- Per-row scroll restoration across full-page nav. Modal path = primary, ⊥ has problem.

## Detail modal

Two surfaces, one body. `peek` search param drives overlay. Real route = deep link.

### Trigger

`Card` click handler: `event.preventDefault(); router.navigate({ search: prev => ({ ...prev, peek: item.id }), replace: false })`.

`replace: false` load-bearing — TanStack Router default = `replace: true`, would skip history → browser-back skips dismiss. Dismiss uses default `replace: true` (rewrite, ⊥ stack).

Middle-click / Cmd-click / "Open in new tab" → fall through to `<a href="/media/<id>">`.

`peek` validated via `peekSchema` (`^(movie|tv):\d+$`) at route def. Invalid stripped before component.

### Modal location

At `_authenticated` layout level, ⊥ home route. ∀ authenticated routes setting `peek` = modal free.

Layout reads via `useSearch({ strict: false })`. Either declare `peek` on `_authenticated` search schema (child routes inherit) OR re-validate via `peekSchema.safeParse` in modal. Pick one, document.

### Pseudocode

```
MediaDetailModal:
  peek = useSearch({ strict: false }).peek
  close = () => router.navigate({ search: prev => ({ ...prev, peek: undefined }) })
  return (
    <Dialog open={!!peek} onOpenChange={o => !o && close()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] [<sm: w-full h-[100dvh] max-w-none rounded-none]">
        {peek && <MediaDetailBody id={peek} inModal />}
      </DialogContent>
    </Dialog>
  )

MediaDetailPage:                       # /media/$id
  id = Route.useParams().id
  return <MediaDetailBody id={id} inModal={false} />
```

### `MediaDetailBody`

- `inModal=true`: ⊥ page header, ⊥ back button. Fits dialog width.
- `inModal=false`: page header + back button (`router.history.go(-1)` or `/` fallback).
- Detail data model + layout = own spec, later doc.
- Resume playback button lives here. Uses `item.resumeUrl` if non-null.

### Close

- Outside click → dismiss (shadcn default).
- Escape → dismiss.
- Browser back → dismiss (open uses `replace: false`, close uses default `replace: true`).
- `X` button → dismiss.

∀ paths → same `close()` fn. Scroll position + row state untouched (home ⊥ unmounted).

### A11y

shadcn `Dialog` primitive: focus trap, focus return on close, body scroll lock, `aria-modal`, labelling. ⊥ custom a11y code.

### Anim

shadcn Dialog default fade + subtle scale.

## States

### First load (cold cache)

`getLayout` in flight → skeleton. 4 skeleton rows + top-zone skeleton (hero cell + maybe upcoming cell). Skeleton card mix = expected mix for typical layout (2 backdrop + 2 poster). shadcn `Skeleton`.

### Revalidation (warm)

Cached layout renders immediately. Background refetch on focus after 60s stale. ⊥ spinner, ⊥ layout shift.

### Empty layout (`rows: []`)

Centered, max-w 420px:

- "Nothing to show yet."
- "Connect a service to start seeing your media."
- Button: `Connect a service →` → `/connections`.

⊥ illustration. Typography-driven. `CenteredState` primitive shared w/ error.

### Full fetch error (`home.internal` or network)

- "Couldn't load your home feed."
- "Something went wrong. Give it a moment and try again."
- Button: `Retry` → `refetch()`.

⊥ raw error msg.

### Partial row indicator

`HomeRow.partial === true` → 14px `AlertTriangle`, `--color-text-tertiary`, right of row title. shadcn `Tooltip`: "Some sources didn't respond — showing what we could fetch."

### Row unavailable mid-session (`home.row_unavailable`)

`useRowPagination` catches → callback to `HomeFeedContent` → removes row from local state. Single shadcn `Toast`: "{Row title} is no longer available." ⊥ retry.

### Empty-retained row (`upcomingForYou` + `ok_empty`) — **no longer applies**

Upcoming ⊥ a row, inlined in `getLayout`. If `upcoming` field absent → no upcoming column. ⊥ "all caught up" empty state in v1 (⊥ a row to render empty into).

### End of row

⊥ visual indicator. Row ends. `Next` disables.

### Loading more

Single skeleton card at end. Replaced on success, removed on failure.

### Top zone

- Hero always present.
- Upcoming present → 2-col grid.
- Upcoming absent → 1-col grid, hero full width.
- `<md` → 1-col, upcoming below hero.

### Hero click

`<Card>` click → peek modal. ∀ paths same. Resume in detail body.

### Mutation states

- Optimistic: DB updates immediately. UI flickers across ∀ rows displaying item.
- Pending: ⊥ visual change (mutation already applied optimistically).
- Failure: DB rolls back. shadcn `Toast`: "Couldn't mark watched. Try again."
- Success: ⊥ visual change (optimistic state already correct).

## Responsive

Tailwind: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px).

### Card sizing — purely container-driven

`Card` has ⊥ viewport-keyed CSS. Sizes from container.

```
.card {
  --thumb-threshold: 320px;
  width: 100%;
}

@container (max-width: var(--thumb-threshold)) {
  /* horizontal-thumb layout */
}

@container (min-width: var(--thumb-threshold)) {
  /* vertical layout */
}
```

Parent (Row, UpcomingStack, TopZone hero cell) decides container width via flex-basis or grid track. Card renders accordingly.

### Reference container widths

| Surface         | Container width target         |
| --------------- | ------------------------------ |
| Hero cell `xl`+ | ~700-900px                     |
| Hero cell `<md` | full viewport - padding        |
| Upcoming column | 280-360px                      |
| Row card `xl`+  | 180-280px (poster vs backdrop) |
| Row card `<md`  | 128-220px                      |

### Page-level

- Card gap: 12px desktop, 8px mobile.
- Page horiz padding: 24px (`md`+), 16px mobile.
- Row scroll extends past right padding → last visible card partially cut → signals more.

### Arrows

Hidden on `(hover: none)`. ⊥ user-agent.

### Top zone

- `md`+: 2-col when Upcoming present (`1fr minmax(280px, 360px)`), else 1-col.
- `<md`: 1-col, Upcoming below hero. `100dvh` (⊥ `100vh`) for any full-height affordance (iOS Safari address bar).

### Modal

shadcn `Dialog` defaults ⊥ auto fullscreen mobile. Override:

- `sm:max-w-3xl max-h-[90vh]` desktop.
- `<sm`: `w-full h-[100dvh] max-w-none max-h-none rounded-none`.

### Typography

- Row titles: 15px ∀ viewports.
- Card title: 14px desktop, 13px mobile.
- Card metadata (year, episode, match reason, captions): 12px desktop, 11px mobile.

### ⊥ change responsively

- Status pills, rating badges, progress bars: same px size ∀ sizes.
- Row count + order: identical ∀ viewports. Layout = server-side, responsive = pure presentation.

### Touch

- Drag-to-scroll: native (embla).
- Tap-to-open: `<a>` click.
- Momentum: embla inertia.

## Testing

`vp test` harness, patterns from `/connections` tests.

### Component

One file per component, colocated.

- `card.test.tsx`: ∀ layout × aspect × treatment matrix. Container query mocked via parent width. Click → peek navigation. Hover anim classes applied (⊥ visual regression — class assertions). `prefers-reduced-motion` → reduced classes.
- `progress-bar.test.tsx`: renders width from progress %, text rendering.
- `top-zone.test.tsx`: 2-col when upcoming present, 1-col when absent. `<md` collapses 1-col.
- `upcoming-stack.test.tsx`: renders 3-4 cards, ShowMore conditional.
- `row.test.tsx`: live query hook fed by collections. Loading (no data yet), populated, partial indicator.
- `row-carousel.test.tsx`: embla init, `Previous` disabled at start, `Next` disabled at end + cursor null, arrow visibility on hover/focus, keyboard arrow nav, pagination at 75%.
- `home-feed.test.tsx`: branches loading/empty/content/error.
- `media-detail-modal.test.tsx`: opens on valid `peek`, closes on Escape/outside/X → `peek: undefined`. Malformed `peek` ⊥ open.
- `home-feed-skeleton.test.tsx`: renders top-zone skeleton + 4 row skeletons w/ expected card mix.
- `*-empty.test.tsx`, `*-error.test.tsx`: CenteredState primitive rendered w/ correct copy + button.
- `status-pill.test.tsx`: semantic color per status, SR text.
- `match-reason.test.tsx`: muted multi-line under title.

### Hook

- `use-home-layout.test.ts`: fetches `home.getLayout`, hydrates `mediaCollection` + `rowEntriesCollection` (`upcoming` + `hero`), 60s staleTime, error on `home.internal`.
- `use-row-pagination.test.ts`: first page lazy w/ `initialCursor`, isPending until first page, `fetchNext` appends to collections, terminal cursor → `hasMore = false`, `home.row_unavailable` → `onUnavailable`, partial fetch failure silently drops skeleton.
- `use-row-items.test.ts`: live query joins row-entries × media × progress, re-emits on entity update.

### Collection

- `media-collection.test.ts`: lastWriteWins on `updatedAt`, upsert idempotent.
- `row-entries-collection.test.ts`: insert appends, delete-by-rowId clears row.
- `progress-collection.test.ts`: upsert by mediaId.
- `mutations.test.ts`: markWatched optimistic update, rollback on failure, RPC call shape.

### Integration

testing-library + mocked RPC.

- Full page render w/ fixture `HomeLayoutResponse`. Mix of rows, one `partial: true`. Hero set, upcoming set.
- Click card → modal opens, URL `?peek=movie:550`, home still mounted underneath.
- Close paths: Escape, outside, X, browser back → ∀ clear `peek`, focus returns to triggering card.
- Direct render `/media/movie:550` → `MediaDetailBody` w/o modal wrap.
- Scroll row past 75% → `getRowContent` called, items appended to collections, Row re-renders w/ new cards via live query.
- Mark-watched on a card visible in 2 rows → both rows update instantly (live query).
- Mutation failure → DB rollback, both rows revert, toast shown.
- `partial: true` row → muted icon, tooltip on hover.
- `rows: []` → empty CenteredState w/ working `/connections` link.
- `getLayout` throws → error CenteredState w/ working Retry.
- Touch media query mocked → arrows ⊥ rendered, drag works.
- `prefers-reduced-motion` → cards render w/ static hover state classes.

### ⊥ tested here

- `HomeFeedService` behavior, row fetchers, capability aggregation — server suite.
- `MediaDetailBody` content — later spec.
- TMDB image proxy — infra.
- Plugin runtime / sandbox — plugin-runtime tests.
- Visual regression screenshots — add when card visuals stabilize.

## Open questions / deferred

- **Hero rotation.** Single static hero v1.
- **Hero vertical height on mobile.** Measure on real devices. May compress to fixed 16:9 if too tall.
- **`/upcoming` page.** ShowMore link target. Deferred until upcoming has a Library-grade host page.
- **Hover preview card.** v2.
- **Per-row scroll restoration across full-page nav.** ⊥ preserved v1. Modal path = primary, ⊥ problem.
- **Prefetch detail on card hover.** Low effort (`prefetchQuery`). Deferred until `MediaDetailBody` data spec.
- **"Tap to retry" on failed pagination.** Silent drop today. Low priority.
- **Progressive row loading (SSE).** ⊥ work until backend ships.
- **Row-level user prefs.** Server-first.
- **Impression telemetry.** Per PreferenceEngine spec — ⊥ built.
- **Visual regression tests.** ⊥ worth automating until stable.
- **Keyboard shortcuts** (`/` search, `j/k` rows). ⊥ search page yet.
- **`MediaDetailBody` data spec.** Prerequisite for shipping modal substance.
- **Embla swap.** If `dragFree` + keyboard fight, `keen-slider` obvious swap. ⊥ signal.
- **Sync engine adoption (Electric/PowerSync).** Deferred. Local-first benefits real but commitment large. v2+.
- **Cross-page mutation propagation testing.** When Library/Search/Detail land, integration suite covers home + other-page synchrony.

## Implementation review notes (load-bearing)

∀ implementing PRs MUST address:

- **Modal history (push vs replace).** `replace: false` on open, default on close. Browser-back dismisses. Document.
- **`useSearch({ strict: false })` ⊥ validates.** Either declare `peek` on `_authenticated` search schema OR `peekSchema.safeParse` in modal. Pick, document.
- **Cross-component row removal.** `useRowPagination` `home.row_unavailable` callback up to `HomeFeedContent`. ⊥ Row knows layout-level state.
- **Tab-order through arrow buttons.** Arrows out of Tab order. Cards in Tab. `ArrowLeft`/`Right` on cards. Arrows SR-discoverable via role/label.
- **Skeleton card shape ratio.** Match expected layout mix (∼50/50 backdrop/poster), ⊥ alternate.
- **`home-feed-error.tsx` + `home-feed-empty.tsx` overlap.** Implement once as `CenteredState`, use both.
- **Row error boundary.** Single bad item ⊥ crash whole feed. Wrap each `Row` in error boundary that hides only that row.
- **`(hover: none)` + keyboard on touch.** iPad w/ keyboard matches `(hover: none)` + supports Tab. Arrow visibility consistent w/ Tab decision. ⊥ invisible tab stops.
- **Progress bar color token.** ⊥ `--color-text-danger`. Introduce `--color-progress-watched` or pick non-text role.
- **`@ent-mcp/shared/home` subpath export.** Coordinate w/ backend if export ⊥ landed.
- **`updatedAt` server stamp.** Server MUST stamp ∀ entity emit. Client rejects items w/o `updatedAt` (dev-mode assertion).
- **`clearLogo` overlay.** Backdrop mode + item.clearLogo only. Bottom-right, max 30% img width. Z-index above progress bar? Decide — start: above progress bar but below status pill.
- **Container query threshold = CSS var.** Single `--card-thumb-threshold` source. Tunable w/o code change.
- **DB collection lifecycle.** Collections persist across home navigations (avoid re-hydrate). Cleared on logout. Memory cap: ⊥ explicit v1, monitor.
- **Live query + Suspense.** TanStack DB live queries can throw on first read if collections ⊥ hydrated. Wrap Row in Suspense boundary OR use non-suspending hook variant. Pick, document.
- **Mutation rollback toast.** Single source for ∀ mutation failures. ⊥ each mutation rolls own toast.
- **Hero click parity.** Hero card uses same Card component — same click handler — same peek navigation. ⊥ special-case.
- **Upcoming "Show more" target.** `/upcoming` route ⊥ exist v1. Either: hide ShowMore until route exists (server omits `showMoreLink`), OR ShowMore = no-op + console warn dev-mode. Pick one.

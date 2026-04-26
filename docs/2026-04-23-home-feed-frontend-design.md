# Home Feed — Frontend Design

**Status:** Draft
**Date:** 2026-04-23
**Author:** Omid Astaraki
**Companion:** `2026-04-22-home-feed-design.md` (backend spec)
**Deps:** `2026-04-22-frontend-plugin-connections-design.md`, `2026-04-19-error-management-design.md`, `2026-04-20-preference-engine-design.md`

## Summary

Netflix-style home page rendering two oRPC procedures from companion backend spec. Single `home.getLayout` call → full page at first paint, rows inlined with first items page. Horizontal scroll → `home.getRowContent`. Card click → detail modal via `peek` search param; `/media/$id` = real-route deep link for shares & deep navigation.

Scope: client-side only — route, component tree, row scroll, card visuals, detail-modal, non-happy-path states. Server behavior out of scope, unchanged from backend spec.

No row-specific branching in page code — rows driven by `rowId` & `HomeRow` shape. Single source of truth for row-specific visual config (`ROW_DISPLAY`).

## Goals

- Render 7-row layout from `home.getLayout` with zero row-specific branching in page code.
- Match visual language of `/connections` & `/taste`: shadcn/ui, typography-driven, flat surfaces, no gradients/ornament.
- Card click feels instant; feed scroll position preserved when modal closes.
- Horizontal scroll works with trackpad, mouse drag, touch swipe, keyboard; arrow buttons surface on hover.
- Degrade honestly across same user-state spectrum as backend.
- Card-treatment split from backend data model: landscape backdrops for `continueWatching` & `upcomingForYou`, tall posters everything else.

## Non-goals

- Hero/billboard unit — additive when backend ships `layout.hero`.
- Netflix-style hover-preview card — deferred v2.
- Infinite vertical scroll of rows — row set small & fixed by layout endpoint.
- SSR — current client = Vite SPA; TanStack Start needed, out of scope.
- Client-side row reordering or drag-to-customize.
- Row-level user preferences — all ordering lives server-side in `rules.ts`.
- Impression/engagement telemetry — matches PreferenceEngine spec's "no things-we-showed-this-user tracking."

## Stack

- TanStack Router (file-based routes under `packages/client/src/routes/`).
- React + TypeScript, Vite.
- shadcn/ui, `lucide-react` icons (matches `/connections` & `/taste`).
- oRPC client + tanstack-query (existing pattern).
- `embla-carousel-react` for row horizontal scroll — ~10kb, maintained, battle-tested. Drag + snap + arrow-button hooks without rolling pointer-event handling.
- Shared types from `@ent-mcp/shared/home` per backend spec's shared-package rule.

Dashboard shell (sidebar nav, header, theme toggle) already exists. Design covers page content only.

## Route and entry point

**Route:** `/` — home feed = root authenticated route. Login lands here.

**Route file:** `packages/client/src/routes/_authenticated/index.tsx`.

Prior root displaced — redirect from prior root = one-line migration if needed.

**Deep-link detail route:** `packages/client/src/routes/_authenticated/media.$id.tsx`. Matches `/media/movie:550` & `/media/tv:1396`; `id` param = composite `MediaId`.

Route declares Zod schema on `params` (same `^(movie|tv):\d+$` regex `peek` uses) via TanStack Router's `params.parse`. Invalid `$id` → framework error boundary → same "Not found" surface as not-resolved upstream. One error surface, zero defensive parsing in modal.

**Sidebar nav:** new item "Home", positioned above "Connections" & "Taste profile." `lucide-react` `Home` icon. Shell's active-route highlighting handles selected state.

**Page title:** no visible `h1` — streaming-service homes don't render "Home" as heading, row titles carry hierarchy. Browser tab title via TanStack Router `meta`: `"Home · {App name}"`.

**Auth:** inherited from `_authenticated` layout. Unauthenticated → redirect to login.

## Core data model on frontend

All wire types imported verbatim from `@ent-mcp/shared/home`:

```ts
import type {
  RowKind,
  HomeRow,
  HomeLayoutResponse,
  RowContentResponse,
  CompactMediaItem,
} from "@ent-mcp/shared/home";
```

No type mirroring, no re-declaration.

### Client-only types

```ts
// Maps rowId → how the row renders. The ONLY place row-specific visual
// decisions live. Everything else reads from HomeRow and CompactMediaItem.
type RowDisplayConfig = {
  cardShape: "poster" | "backdrop";
  showMatchReasonInline: boolean; // true on recommendedForYou
  // HomeRow.subtitle from the server already carries "Because you watched X"
  // on seed rows — the client adds no extra subtitle logic.
};

const ROW_DISPLAY: Record<RowKind, RowDisplayConfig> = {
  continueWatching: { cardShape: "backdrop", showMatchReasonInline: false },
  upcomingForYou: { cardShape: "backdrop", showMatchReasonInline: false },
  recommendedForYou: { cardShape: "poster", showMatchReasonInline: true },
  becauseYouWatched: { cardShape: "poster", showMatchReasonInline: false },
  trendingNow: { cardShape: "poster", showMatchReasonInline: false },
  newReleases: { cardShape: "poster", showMatchReasonInline: false },
  yourWatchlist: { cardShape: "poster", showMatchReasonInline: false },
};

// Search-param schema for the detail-modal peek.
const peekSchema = z.object({
  peek: z
    .string()
    .regex(/^(movie|tv):\d+$/)
    .optional(),
});
```

`ROW_DISPLAY` = only place row-specific presentation logic exists. Adding row on backend → add one entry here; rest of page code untouched. No separate `PosterCard`/`BackdropCard` data shapes — both variants render from same `CompactMediaItem`.

### Cursors are opaque

Frontend treats `HomeRow.cursor` & `getRowContent` return as black-box strings. No parsing, inspection, version-checking — backend's job per companion spec.

## Page architecture

### Component tree

```
HomeFeedPage (route component at /)
├── HomeFeedSkeleton        (while first getLayout is in flight on cold cache)
├── HomeFeedEmpty           (when layout returns rows: [])
└── HomeFeedContent
    └── Row[]                (one per HomeRow)
        ├── RowHeader        (title + optional subtitle + partial indicator)
        └── RowCarousel      (embla instance; manages scroll, arrows, pagination trigger)
            └── Card[]       (CardPoster | CardBackdrop, picked via ROW_DISPLAY[rowId].cardShape)

MediaDetailModal             (portal, mounted by the _authenticated layout when ?peek= is set)
└── MediaDetailBody          (shared body component used by modal + /media/$id)
```

### File layout

```
packages/client/src/
├── routes/_authenticated/
│   ├── index.tsx                    # HomeFeedPage — route component
│   └── media.$id.tsx                # MediaDetailPage — full-route deep link
├── components/home/
│   ├── home-feed.tsx                # picks skeleton / empty / content / error
│   ├── row.tsx                      # RowHeader + RowCarousel + pagination glue
│   ├── row-carousel.tsx             # embla wrapper: scroll, arrows, snap, "near end" signal
│   ├── card.tsx                     # dispatches to poster or backdrop variant
│   ├── card-poster.tsx              # 2:3 variant
│   ├── card-backdrop.tsx            # 16:9 variant with progress / episode overlays
│   ├── status-pill.tsx              # requested / processing / unavailable
│   ├── rating-badge.tsx             # user rating corner badge
│   ├── match-reason.tsx             # muted multi-line reason under title
│   ├── home-feed-skeleton.tsx
│   ├── home-feed-empty.tsx
│   ├── home-feed-error.tsx
│   ├── media-detail-modal.tsx       # dialog wrapper; reads ?peek from search
│   └── media-detail-body.tsx        # content body, shared with full-route page
├── lib/
│   └── home-display.ts              # ROW_DISPLAY + peekSchema
└── hooks/
    ├── use-home-layout.ts           # tanstack-query wrapper for home.getLayout
    └── use-row-pagination.ts        # internal hook for home.getRowContent
```

### Data flow

- **`useHomeLayout()`** — single tanstack-query call against `home.getLayout`. Cache key: `["home", "layout"]`. Stale time: 60s. Background revalidate on window focus after 60s while keeping current layout on screen.
  - **`HomeLayoutResponse.generatedAt` v1:** received, intentionally unused. 60s staleTime anchored on tanstack-query's fetch-completion timestamp. `generatedAt` retained in wire type (backend spec calls it client-facing) so future "Last updated X ago" affordance can adopt without contract change. No component reads it v1.
- **`useRowPagination(rowId, initialCursor, initialItems)`** — internal to `Row`. State: `{ items: CompactMediaItem[], cursor: string | null, isFetching: boolean }`. Initial items & cursor from `HomeRow` inline. When `RowCarousel` signals "near end" (≥75% scroll progress, debounced 150ms) → fires `home.getRowContent` → appends. Stops when cursor `null`. On `home.row_unavailable` → signals parent to remove row.
- Detail fetch out of scope — `MediaDetailBody` has own data-shape spec in later doc.

### What lives where

- `index.tsx` thin: calls `useHomeLayout`, picks top-level branch (skeleton/empty/content/error), renders. ~40 lines.
- `row.tsx` owns row-local pagination state. ⊥ knows card shape — `card.tsx`'s job.
- `card.tsx` small dispatcher (~20 lines): reads `ROW_DISPLAY[rowId].cardShape`, renders `CardPoster` or `CardBackdrop`. No row logic.
- `ROW_DISPLAY` in `lib/home-display.ts` = single source of truth for row-specific visual behavior.

### What doesn't exist

- No shared "CarouselRow" abstraction with generic knobs — `RowCarousel` specific to home feed; extract if second feature needs it.
- No virtualization inside row — each row caps ~40–60 items; regular DOM handles fine. Revisit if `recommendedForYou` grows unbounded.

## Row behaviour

### Embla configuration per row

```ts
{
  dragFree: true,              // free pan; no forced page-by-page snap
  containScroll: "trimSnaps",  // no empty space past first/last card
  slidesToScroll: "auto",      // arrow clicks advance by ~viewport width
  align: "start",              // visible slice starts at a card boundary
  loop: false,
}
```

Free drag with inertia for touch & trackpad; arrow clicks move viewport-width cards. Disney+ / HBO interaction pattern.

### Arrow buttons

- Hidden at rest on hover-capable pointer devices.
- Revealed on row hover **or** when any card/arrow inside row has focus — keyboard users see without needing pointer.
- ⊥ rendered on touch-primary devices — `@media (hover: none)`, ⊥ user-agent sniffing.
- `Previous` disabled at scroll start. `Next` disabled when scrolled to end **& `cursor === null`** (no more pages).
- Positioned absolutely at row edges, vertically centered against card area only (⊥ including title/metadata block).

### Pagination trigger

Each `RowCarousel` listens to embla's `scroll` event (debounced 150ms). When scroll progress ≥75% of rendered slides & `cursor !== null` & ⊥ fetch in flight → calls `useRowPagination.fetchNext()`.

While fetch in flight: single skeleton card at end of row. On success: replaced by new cards. On failure: disappears silently.

### Keyboard navigation

- `Tab` lands on row's `Previous` arrow, then first visible card, then cards in order, then `Next` arrow.
- `Enter`/`Space` on focused card → opens detail modal (navigates with `peek=<id>` search param).
- `ArrowLeft`/`ArrowRight` on focused card → moves focus & scrolls row to keep focused card in view.
- `Escape` ⊥ applies at row level — modal's concern.

### Snap and scroll restoration

- Horizontal snap: embla's default elastic snap on drag end.
- Modal close: home page ⊥ unmounted — row horizontal positions persist naturally.
- Full-route navigation back from `/media/$id`: TanStack Router restores vertical scroll by default. **Horizontal row positions ⊥ restored across full-page navigation.** Modal path (common click target) ⊥ has this problem. Deferred v2.

### Touch and pointer specifics

- Tap-to-open vs drag-to-scroll disambiguation: embla's responsibility.
- ⊥ custom long-press behavior v1.

## Card designs

### Poster card (`CardPoster`)

2:3 aspect ratio. Used for `recommendedForYou`, `trendingNow`, `newReleases`, `becauseYouWatched`, `yourWatchlist`.

Desktop: 180px wide (≈270px tall). ~6 across 1440px viewport.
Mobile: 128px wide (≈192px tall). ~2.5 across 375px.

**Always rendered:**

- Poster from `item.poster` (TMDB-proxied). Missing → flat `--color-background-secondary` tile, title centered in small muted text.
- Title below card — 14px, weight 500, 2-line clamp.
- Year below title — 12px, muted.

**Conditional overlays (positioned absolutely inside poster):**

- **Status pill** top-right, 8px inset. Only for `requested`/`processing`/`unavailable`. ⊥ for `available`/`unknown`. Colors: `warning`/`info`/`danger`.
- **User rating** bottom-left (small star icon + number) when `item.userRating` present.
- **Match reason** below title (2-line clamp, 11px, muted). Only when `ROW_DISPLAY[rowId].showMatchReasonInline === true` & `item.matchReason` present.

**Hover:** subtle `scale(1.02)`, 120ms ease. ⊥ Netflix-style expand/reveal. Cursor pointer. Keyboard focus: standard shadcn focus-visible outline.

### Backdrop card (`CardBackdrop`)

16:9 aspect ratio. Used for `continueWatching` & `upcomingForYou`.

Desktop: 280px wide (≈158px tall). ~4 across.
Mobile: 220px wide (≈124px tall). ~1.5 across.

**Always rendered:**

- Backdrop from `item.backdrop`, landscape-cropped `item.poster` as fallback.
- Title below card — 14px, weight 500, 1-line clamp.
- Row-specific detail line below title.

**Conditional overlays:**

- **Progress bar** pinned to bottom edge of backdrop image (inside image, ⊥ below it). 3px tall, full width. Background: 20% opacity (theme-aware); fill: `var(--color-text-danger)`. Only on `continueWatching`.
- **Status pill** top-right — same rules as poster card.
- **User rating** bottom-left — same rules, **only when progress bar absent** (i.e. on `upcomingForYou`; bar would collide on `continueWatching`).

**Row-specific detail line:**

- `continueWatching`: "22 min left" for movies, "S2 E4 · 22 min left" for TV. From `progress.total - progress.watched` + episode metadata on item.
- `upcomingForYou`: "S2 E4 · Fri 9pm" from `item.episode.{season,episode,airsAt}`. `airsAt` formatted relative for near dates ("tomorrow"), weekday this week ("Fri"), full date after.

### Shared rules

- Images `loading="lazy"` + `decoding="async"`. ⊥ custom blur-up — neutral background fill while loading is enough.
- ∀ cards rendered as `<a href={`/media/${item.id}`}>`, not `<button>`. Middle-click, Cmd/Ctrl-click, "Open in new tab" work naturally. Click handler intercepts default, updates `peek` search param; modifier-clicks fall through to real URL.
- Card component signature: `<Card item={...} rowId={...} />`. Dispatches via `ROW_DISPLAY[rowId].cardShape`. No other row-specific branching in card code.
- `StatusPill`, `RatingBadge`, `MatchReason` in dedicated sub-components — both card variants render from same primitives.

## Detail modal

Two surfaces, one body. `peek` search param drives overlay; real route = deep link.

### Trigger

- `<Card>`'s click handler calls `event.preventDefault()`, updates search: `router.navigate({ search: (prev) => ({ ...prev, peek: item.id }), replace: false })`. `replace: false` load-bearing — TanStack Router default for search updates = `replace: true`, which ⊥ pushes history entry → browser-back would skip past modal dismiss (see Implementation review notes).
- Middle-click/Cmd+click/"Open in new tab" fall through to native `<a href="/media/<id>">`.
- `peek` param validated via `peekSchema` on route definition. Invalid values stripped by TanStack Router before reaching components — no defensive parsing in modal.

### Where modal lives

At `_authenticated` layout level, **not** home route. ∀ authenticated routes setting `peek` get modal free. Future `/search`, `/library`, etc. get overlay without re-implementing it.

Layout reads search via `useSearch({ strict: false })`.

### Component structure

```tsx
// MediaDetailModal — rendered by the _authenticated layout
function MediaDetailModal() {
  const { peek } = useSearch({ strict: false });
  const router = useRouter();
  // Close uses the default `replace: true` — we want the dismiss to replace
  // the "peek open" history entry, not push a new one on top of it. That way
  // one browser-back dismisses and the preceding entry is whatever the user
  // was on before opening the modal.
  const close = () => router.navigate({ search: (prev) => ({ ...prev, peek: undefined }) });

  return (
    <Dialog open={!!peek} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-3xl">
        {peek && <MediaDetailBody id={peek} inModal />}
      </DialogContent>
    </Dialog>
  );
}

// MediaDetailPage — route at /media/$id
function MediaDetailPage() {
  const { id } = Route.useParams();
  return <MediaDetailBody id={id} inModal={false} />;
}
```

### `MediaDetailBody`

- Single component, two contexts: `id` + `inModal`.
- `inModal: true` — no page-level header, no back button (modal's close affordance handles dismiss), fits dialog's width constraint.
- `inModal: false` — page-level header with back button (`router.history.go(-1)`, or `/` fallback when no history).
- Detail view's data model & layout out of scope — later doc owns media detail.

### Close behaviour

- Click outside → dismiss (shadcn Dialog default).
- `Escape` → dismiss.
- Browser back → dismiss. Card open-transition uses `replace: false` (push); close call uses default `replace: true` (rewrite). Net: one back-press = "modal open" → "home feed without peek."
- Close button (top-right `X`) → dismiss.

∀ paths route through same `close()` function: clear `peek` param. Scroll position & row state untouched — home route ⊥ unmounted.

### Focus, scroll lock, accessibility

All handled by shadcn `Dialog` primitive: focus trap, focus return to triggering card on close, body scroll lock, `aria-modal`, proper labelling. No custom a11y code.

### Animations

shadcn Dialog default fade + subtle scale.

## States

### First load (no cache)

While `home.getLayout` in flight on cold cache: skeleton layout — 4 skeleton rows, each with narrow bar for row title + ~6 card-shaped skeletons. Alternate skeleton card shape across 4 rows (poster/backdrop/poster/backdrop) so shimmer matches eventual shape mix. Use shadcn `Skeleton`.

### Revalidation (warm cache)

Cached layout renders immediately. Background refetch fires when stale (>60s) on focus. No spinner; no layout shift.

### Empty layout (`rows: []`)

Centered layout, max-width ~420px:

- Title (h2, 18px, weight 500): "Nothing to show yet."
- Body (muted): "Connect a service to start seeing your media."
- Primary button: `Connect a service →` → `/connections`.

No illustration, no icon — matches typography-driven tone of `/connections` & `/taste`.

### Full fetch error (`home.internal` or network)

- Title: "Couldn't load your home feed."
- Body: "Something went wrong. Give it a moment and try again."
- Primary button: `Retry` — calls tanstack-query's `refetch()`.

No raw error message shown.

### Partial row indicator

`HomeRow.partial === true` → small muted `AlertTriangle` icon (14px, `--color-text-tertiary`) right of row title. shadcn `Tooltip`: "Some sources didn't respond — showing what we could fetch." Row renders cards normally. Ambient, ⊥ intrusive.

### Row unavailable mid-session (`home.row_unavailable`)

`useRowPagination` catches error, signals parent to remove row from local state. Single shadcn `Toast`: "{Row title} is no longer available." No retry affordance — row genuinely ⊥ fetchable; full page reload gets fresh layout.

### Empty-retained row (`upcomingForYou` + `ok_empty`)

Row header renders normally. Card area: single muted line "You're all caught up on upcoming episodes." Centered vertically in row's card-area height.

### End of row (cursor `null`, scrolled to end)

No visual indicator. Row ends; `Next` arrow disables.

### Loading more (cursor ≠ null, fetch in flight)

Single skeleton card at end of row. Replaced by real cards on success, removed on failure without inline error.

## Responsive treatment

Breakpoints follow existing Tailwind convention: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px).

### Card dimensions

| Viewport | Poster (width × height) | Backdrop (width × height) |
| -------- | ----------------------- | ------------------------- |
| `xl`+    | 180 × 270               | 280 × 158                 |
| `lg`     | 160 × 240               | 250 × 141                 |
| `md`     | 140 × 210               | 220 × 124                 |
| `<md`    | 128 × 192               | 220 × 124                 |

Heights auto-derive from aspect ratio — driving widths, ⊥ fixed pixel boxes. Tailwind responsive prefixes on `flex-basis`.

### Row gutters and page padding

- Card gap: 12px desktop, 8px mobile.
- Page horizontal padding: 24px (`md`+), 16px mobile.
- Row scroll area extends past right page padding — last visible card partially cut off → signals "more to scroll." Negative margin + corresponding padding inside scroll container.

### Arrows

Hidden on touch-primary via `@media (hover: none)`. ⊥ user-agent sniffing.

### Modal → full-screen on mobile

shadcn `Dialog` ⊥ auto-goes-fullscreen on mobile. Override via responsive classes on `DialogContent`:

- `sm:max-w-3xl max-h-[90vh]` on desktop (scrollable dialog).
- Below `sm`: `w-full h-[100dvh] max-w-none max-h-none rounded-none` — covers viewport.

Use `100dvh` (⊥ `100vh`) → iOS Safari address-bar collapse ⊥ causes layout jumps.

### Typography sizing

- Row titles: 15px all viewports. Already compact; shrinking further muddies hierarchy.
- Card title: 14px desktop, 13px mobile.
- Card metadata (year, episode line, match reason): 12px desktop, 11px mobile.

### Touch interactions

- Drag-to-scroll: native (embla's pointer handling).
- Tap-to-open: `<a>` click.
- Momentum scroll: embla inertia; ⊥ tune.

### What doesn't change responsively

- Status pills, user rating badges, progress bars: same absolute pixel size — already small; scaling down makes unreadable.
- Row count & order: identical across viewports — layout rule table server-side; responsive = pure presentation.

## Testing

Follows existing `vp test` harness & patterns from `/connections` tests.

### Component tests

One file per component, colocated.

- `row-carousel.test.tsx`: embla initializes with expected config; `Previous` disabled at scroll start; `Next` disabled when at end & cursor null; arrows hidden without hover, revealed with row focus; pagination callback fires at 75% threshold debounced; keyboard arrow nav scrolls to keep focus in view.
- `card.test.tsx`: dispatches to `CardPoster` for poster rowId, `CardBackdrop` for backdrop rowId; no other branches reachable.
- `card-poster.test.tsx`: title + year always rendered; status pill for `requested`/`processing`/`unavailable`, **⊥** for `available`/`unknown`; user rating when `userRating` present; match reason only when `ROW_DISPLAY[rowId].showMatchReasonInline && item.matchReason`.
- `card-backdrop.test.tsx`: progress bar on `continueWatching` with width matching `progress.watched / progress.total`; episode detail line on `upcomingForYou` with formatted airdate; user rating bottom-left only when progress bar absent.
- `status-pill.test.tsx`: semantic color per status; visually-hidden text for screen readers ("Status: Requested").
- `media-detail-modal.test.tsx`: opens when `peek` = valid `MediaId`; closes on Escape/outside click/close button → `peek: undefined`; malformed `peek` values ⊥ open modal.
- `home-feed-skeleton.test.tsx`: renders 4 rows with alternating poster/backdrop skeleton shapes.
- `home-feed-empty.test.tsx`: renders CTA with working link to `/connections`.
- `home-feed.test.tsx`: branches correctly on loading/empty/content/error.

### Hook tests

- `use-home-layout.test.ts`: fetches `home.getLayout`, caches under `["home", "layout"]`, revalidates background after 60s stale; error state on `home.internal`.
- `use-row-pagination.test.ts`: initial items from `HomeRow.items`; `fetchNext` appends on success; terminal cursor → `hasMore = false`; `home.row_unavailable` triggers row-removal callback; partial failures during scroll-fetch silently drop skeleton card.

### Integration tests

(testing-library + mocked oRPC client)

- Full page render with fixture `HomeLayoutResponse` (mix of rows, one `partial: true`, one `upcomingForYou` + `ok_empty`).
- Click card → modal opens, URL shows `?peek=movie:550`, home page still mounted underneath.
- Close modal via each path: Escape, outside click, close button, browser back — all clear `peek`, return focus to triggering card.
- Direct-render `/media/movie:550` as full route → `MediaDetailBody` mounts without modal wrapping.
- Scroll row past 75% → `getRowContent` called with correct `rowId` & cursor; appended items render.
- Row with `partial: true` → muted icon next to title; tooltip copy correct on hover.
- `rows: []` → empty state with working `/connections` link.
- `getLayout` throws → error state with working Retry button.
- Touch media query mocked (`hover: none`) → arrow buttons ⊥ rendered; drag still works.

### Not tested here

- `HomeFeedService` behavior, row fetchers, capability aggregation — server test suite.
- `MediaDetailBody` content rendering — later media detail spec.
- TMDB image proxy behavior — infrastructure.
- Plugin runtime/sandbox — plugin-runtime tests.
- Visual regression screenshots — add when UI stabilizes.

## Open questions / deferred

- **Hero/billboard unit.** Additive when backend ships `layout.hero`. Frontend change = new top-slot component.
- **Netflix-style hover preview card.** Genuine work — deferred v2.
- **Horizontal row scroll restoration across full-page navigation.** ⊥ preserved v1. If users complain, stash per-row `scrollLeft` in Zustand store keyed on `rowId`.
- **Prefetch media detail on card hover.** Low effort (`prefetchQuery`). Deferred until `MediaDetailBody` data spec written.
- **"Tap to retry" on failed pagination.** Failed `getRowContent` silently drops skeleton today. Low priority.
- **Progressive row loading (SSE).** ⊥ work until backend ships it.
- **Row-level user preferences.** Server feature first.
- **Impression/engagement telemetry.** Explicitly ⊥ built, matching PreferenceEngine spec.
- **Visual regression tests.** ⊥ worth automating until card visuals stabilize.
- **Keyboard shortcuts** (`/` for search, `j/k` between rows). ⊥ search page yet.
- **Media detail body spec.** Own spec = prerequisite for actually shipping modal.
- **Embla replacement.** If `dragFree` + keyboard fights at edges, `keen-slider` obvious swap. ⊥ signal yet.

## Implementation review notes (2026-04-23)

Load-bearing details from design review — ∀ implementing PRs must address:

- **Modal history (push vs replace).** TanStack Router default for search updates = `replace: true`. Browser-back to dismiss → `peek` open transition ! explicitly opt in to `replace: false`. Dismiss can replace.
- **`useSearch({ strict: false })` ⊥ validates.** With `strict: false`, layout-level modal receives raw search params. Either declare `peek` on `_authenticated` layout's search schema (child routes inherit) or re-validate via `peekSchema.safeParse` inside modal. Pick one, document it.
- **Cross-component row-removal mechanism.** `useRowPagination` catches `home.row_unavailable` & "signals parent." Mechanism — callback prop `HomeFeedContent` → `Row` → `useRowPagination`, or shared reducer keyed on `rowId` — left to implementer. Must keep `Row` agnostic of layout-level state.
- **Tab-order through arrow buttons.** 7 rows × 2 arrows = 14 extra tab stops before keyboard users reach any card. Reconsider: arrows out of Tab order, focusable via carousel pattern (cards in Tab; `ArrowLeft`/`ArrowRight` on focused cards). Arrows SR-discoverable via role/label.
- **Skeleton card shape ratio.** "Alternate poster/backdrop across 4 rows" produces shimmer-then-settle jank for plugin-less case (all posters). Either always poster, or match expected mix for user's most likely layout.
- **`home-feed-error.tsx` & `home-feed-empty.tsx` overlap.** Both = centered title + body + action button. Implement once as `CenteredState` primitive, use from both.
- **Row error boundary.** Single bad item/unhandled card render error ⊥ crash whole feed. Wrap each `Row` in error boundary that hides only that row.
- **`@media (hover: none)` + keyboard on touch devices.** iPad with keyboard matches `(hover: none)` & supports Tab. Arrow visibility rule ! be consistent with Tab-order decision above; ⊥ produce invisible tab stops.
- **Progress bar color token.** `--color-text-danger` = text color used on non-text surface. Introduce `--color-progress-watched` or pick non-text role.
- **`@ent-mcp/shared/home` subpath export.** Backend spec mandates this; coordinate if spec landed before export.

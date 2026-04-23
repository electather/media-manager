# Home Feed — Frontend Design

**Status:** Draft for review
**Date:** 2026-04-23
**Author:** Omid Astaraki
**Companion:** `2026-04-22-home-feed-design.md` (backend spec)
**Depends on:** `2026-04-22-frontend-plugin-connections-design.md` (shared stack conventions), `2026-04-19-error-management-design.md`, `2026-04-20-preference-engine-design.md`

## Summary

The Home Feed frontend is the user-facing Netflix-style home page that renders the two oRPC procedures defined in the companion backend spec. A single `home.getLayout` call produces the full page at first paint — rows are inlined with their first page of items; horizontal scroll within a row triggers `home.getRowContent` for subsequent pages. Clicking a card opens a detail modal layered over the feed via a `peek` search parameter, with `/media/$id` as the real-route deep link for shares and deep navigation.

Scope is strictly client-side: route, component tree, row scroll behavior, card visuals, detail-modal presentation, and all non-happy-path states. Server behavior is out of scope and unchanged from the backend spec.

The design follows the same discipline as the backend: no row-specific branching in the page code (rows are driven entirely by `rowId` and the `HomeRow` shape), a single source of truth for row-specific visual config (`ROW_DISPLAY`), and the informative-but-not-loud card density established in clarifying conversation.

## Goals

- Render the seven-row layout from `home.getLayout` with zero row-specific branching in the page code — rows are driven entirely by `rowId` and the `HomeRow` shape.
- Match the visual language of `/connections` and `/taste`: shadcn/ui, typography-driven, flat surfaces, no gradients or ornament.
- Clicking a card feels instant; the feed's scroll position is preserved when the modal closes.
- Horizontal scroll within a row works with trackpad, mouse drag, touch swipe, and keyboard; arrow buttons surface on hover for discoverability.
- Degrade honestly across the same user-state spectrum as the backend (no plugins, TMDB-only, tracker-connected, full install).
- Use the card-treatment split from the backend data model: landscape backdrops for `continueWatching` and `upcomingForYou`, tall posters for everything else.

## Non-goals

- Hero / billboard unit. Additive when the backend ships `layout.hero`.
- Netflix-style hover-preview card (rating, cast, action buttons revealed on hover). Deferred to v2; not worth the build complexity in v1.
- Infinite vertical scroll of rows. The row set is small and fixed by the layout endpoint.
- Server-side rendering of the home feed. The current client is a Vite SPA; SSR would need TanStack Start and is out of scope.
- Client-side row reordering or drag-to-customize.
- Row-level user preferences (hide Trending, pin Continue Watching on top). All ordering lives on the server per the backend `rules.ts`.
- Impression / engagement telemetry. Matches the PreferenceEngine spec's "no things-we-showed-this-user tracking" stance.

## Stack

- TanStack Router (file-based routes under `packages/client/src/routes/`).
- React + TypeScript, Vite.
- shadcn/ui, `lucide-react` icons (matches `/connections` and `/taste`).
- oRPC client + tanstack-query (existing pattern).
- `embla-carousel-react` for row horizontal scroll — small (~10kb), maintained, battle-tested. Gives us drag + snap + arrow-button hooks without rolling pointer-event handling ourselves.
- Shared types imported from `@ent-mcp/shared/home` per the backend spec's shared-package rule.

Dashboard shell (sidebar nav, header, theme toggle) already exists. This design covers page content only.

## Route and entry point

**Route:** `/` — the home feed is the root authenticated route. Logging in lands here. This matches the streaming-service convention and is what "home" means to users on a dashboard whose purpose is to surface media.

**Route file:** `packages/client/src/routes/_authenticated/index.tsx`.

If something currently lives at `/`, it gets displaced — the landing page for an authenticated streaming-service dashboard is the home feed. A redirect from the prior root (if any) is a one-line migration.

**Deep-link detail route:** `packages/client/src/routes/_authenticated/media.$id.tsx` — TanStack Router's dot syntax for a dynamic path segment. Matches `/media/movie:550` and `/media/tv:1396`; the `id` param is the composite `MediaId` from the backend.

The route declares a Zod schema on its `params` (the same `^(movie|tv):\d+$` regex the `peek` search param uses) via TanStack Router's `params.parse`. A URL whose `$id` segment fails the regex is routed to the framework's error boundary, which renders the same "Not found" surface the media-detail spec defines for a well-formed id that doesn't resolve upstream. This keeps the invalid-input path identical to the not-resolved path from the user's perspective — one error surface, delegated to the media-detail spec — and matches the zero-defensive-parsing rule the modal already follows.

**Sidebar nav:** one new item labelled "Home", positioned above "Connections" and "Taste profile" in the existing sidebar. Uses `lucide-react`'s `Home` icon for visual consistency with the rest of the nav. The shell's existing active-route highlighting handles the selected state.

**Page title / subtitle:** no page-level `h1`. Streaming-service homes don't render "Home" as a visible heading — row titles carry the hierarchy. The browser tab title is set via TanStack Router's `meta` to "Home · {App name}".

**Auth:** Inherited from the `_authenticated` layout. Unauthenticated users redirect to the login flow (existing behaviour).

## Core data model on the frontend

All wire types are imported verbatim from `@ent-mcp/shared/home`:

```ts
import type {
  RowKind,
  HomeRow,
  HomeLayoutResponse,
  RowContentResponse,
  CompactMediaItem,
} from "@ent-mcp/shared/home";
```

No type mirroring, no re-declaration. If the shared package doesn't currently export the `/home` subpath, the backend spec mandates it — coordinate with whoever lands the server-side work.

### Client-only types

Two, both presentational:

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
  continueWatching:  { cardShape: "backdrop", showMatchReasonInline: false },
  upcomingForYou:    { cardShape: "backdrop", showMatchReasonInline: false },
  recommendedForYou: { cardShape: "poster",   showMatchReasonInline: true  },
  becauseYouWatched: { cardShape: "poster",   showMatchReasonInline: false },
  trendingNow:       { cardShape: "poster",   showMatchReasonInline: false },
  newReleases:       { cardShape: "poster",   showMatchReasonInline: false },
  yourWatchlist:     { cardShape: "poster",   showMatchReasonInline: false },
};

// Search-param schema for the detail-modal peek.
const peekSchema = z.object({
  peek: z.string().regex(/^(movie|tv):\d+$/).optional(),
});
```

`ROW_DISPLAY` is the one place row-specific presentation logic exists. Adding a row on the backend means adding one entry here; the rest of the page code stays untouched. This mirrors the backend's row-local discipline.

Note what's absent: no separate `PosterCard` / `BackdropCard` data shapes. Both variants render from the same `CompactMediaItem` — they are two presentations of identical data. The card dispatcher picks the template from `cardShape`.

### Cursors are opaque

The frontend treats `HomeRow.cursor` and the return value of `getRowContent` as black-box strings. No parsing, no inspection, no version-checking — that's the backend's job per the companion spec.

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

New files only; existing shell unchanged:

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

- **`useHomeLayout()`** — a single tanstack-query call against `home.getLayout`. Cache key: `["home", "layout"]`. Stale time: 60 seconds — Continue Watching updates fast, but refetching on every navigation is wasteful. On window refocus after 60s, revalidate in background while keeping the current layout on screen (tanstack-query's default SWR behaviour).
  - **`HomeLayoutResponse.generatedAt` in v1:** received, intentionally unused. The 60s staleTime is anchored on tanstack-query's own fetch-completion timestamp, which is what determines background revalidation — not the server-side compose time. `generatedAt` is retained in the wire type (the backend spec calls it out as a client-facing field) so that a later "Last updated X ago" affordance, or a staleness policy that cares about server compose time rather than client fetch time, can adopt it without a contract change. No component reads it in v1; no hook branches on it.
- **`useRowPagination(rowId, initialCursor, initialItems)`** — internal to `Row`. Keeps state `{ items: CompactMediaItem[], cursor: string | null, isFetching: boolean }`. Initial items and cursor come from the `HomeRow` inline. When `RowCarousel` signals "near end of visible items" (≥75% scroll progress within the rendered window, debounced to 150ms), the hook fires `home.getRowContent` and appends. Stops when cursor is `null`. On `home.row_unavailable`, the hook signals the parent to remove the row (see States below).
- Detail fetch is out of scope — `MediaDetailBody` has its own data-shape spec in a later doc. For this design, the modal's job is to mount that component and manage the overlay / close behaviour.

### What lives where

- `index.tsx` (`HomeFeedPage`) is thin: calls `useHomeLayout`, picks the top-level branch (skeleton / empty / content / error), and renders. ~40 lines.
- `row.tsx` owns the row-local pagination state. It knows nothing about card shape — that's `card.tsx`'s job.
- `card.tsx` is a small dispatcher (~20 lines): reads `ROW_DISPLAY[rowId].cardShape`, renders `CardPoster` or `CardBackdrop`, passes the item through. No row logic.
- `ROW_DISPLAY` in `lib/home-display.ts` is the single source of truth for row-specific visual behaviour.

### What doesn't exist

- No shared "CarouselRow" abstraction with generic knobs. `RowCarousel` is specific to the home feed; if a second feature later needs a row-of-cards pattern, extract then.
- No virtualization inside a row. Each row caps at ~40–60 items across all pages before the cursor exhausts; regular DOM handles that fine. Revisit if `recommendedForYou` grows unbounded.

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

Free drag with inertia for touch and trackpad; arrow clicks move by a viewport-width's worth of cards. This is the Disney+ / HBO interaction pattern.

### Arrow buttons

- Hidden at rest on pointer devices that support hover.
- Revealed on row hover **or** when any card / arrow inside the row has focus — keyboard users see them without needing a pointer.
- Never rendered on touch-primary devices; detected via `@media (hover: none)`, not user-agent sniffing.
- `Previous` disabled at scroll start. `Next` disabled when the row is scrolled to the end **and** `cursor` is `null` (no more pages).
- Positioned absolutely at row edges, vertically centered against the card area only (not including the title/metadata block).

### Pagination trigger

Each `RowCarousel` listens to embla's `scroll` event (debounced to 150ms). When scroll progress ≥75% of the rendered slides **and** `cursor !== null` **and** no fetch is in flight, it calls `useRowPagination.fetchNext()`.

While a fetch is in flight, a single skeleton card renders at the end of the row as a lightweight placeholder. On success, it's replaced by the new cards. On failure, it disappears silently — no inline error for this; see the States section.

### Keyboard navigation

- `Tab` lands on the row's `Previous` arrow (focusable even when visually hidden), then the first visible card, then cards in order, then the `Next` arrow.
- `Enter` / `Space` on a focused card opens the detail modal (navigates with `peek=<id>` search param).
- `ArrowLeft` / `ArrowRight` on a focused card moves focus and scrolls the row to keep the focused card in view.
- `Escape` never applies at row level — that's the modal's concern.

### Snap and scroll restoration

- Horizontal snap: embla's default elastic snap on drag end. No extra configuration.
- Modal close: home page never unmounted — row horizontal positions persist naturally.
- Full-route navigation back from `/media/$id`: TanStack Router restores vertical scroll by default. **Horizontal row positions are not restored across full-page navigation.** Acceptable tradeoff — the modal path (the common click target) doesn't have this problem. If it becomes a user complaint, stash row scroll positions in a small Zustand store keyed on `rowId`; deferred to v2.

### Touch and pointer specifics

- Tap-to-open vs drag-to-scroll disambiguation is embla's responsibility. Its default pointer heuristics (drag begins at ~5px movement) are correct.
- No custom long-press behaviour in v1.

## Card designs

### Poster card (`CardPoster`)

2:3 aspect ratio. Used for `recommendedForYou`, `trendingNow`, `newReleases`, `becauseYouWatched`, `yourWatchlist`.

Desktop width: 180px (≈270px tall). Fits ~6 across a 1440px viewport.
Mobile width: 128px (≈192px tall). Fits ~2.5 across a 375px viewport.

**Always rendered:**

- Poster image from `item.poster` (TMDB-proxied). Missing poster falls back to a flat `--color-background-secondary` tile with the title centered in small muted text.
- Title below the card — 14px, weight 500, clamped to 2 lines.
- Year below the title — 12px, muted.

**Conditional overlays (positioned absolutely inside the poster):**

- **Status pill** top-right with an 8px inset. Rendered only when `status` is `requested`, `processing`, or `unavailable`. Not for `available` (noise) or `unknown` (no info). Colors: `warning` / `info` / `danger`.
- **User rating** bottom-left (small star icon + number) when `item.userRating` is present.
- **Match reason** below the title (2-line clamp, 11px, muted). Only rendered when `ROW_DISPLAY[rowId].showMatchReasonInline === true` (`recommendedForYou`) and `item.matchReason` is present.

**Hover:** subtle `scale(1.02)` transform, 120ms ease. Not a Netflix-style expand/reveal. Cursor pointer. Keyboard focus uses the standard shadcn focus-visible outline.

### Backdrop card (`CardBackdrop`)

16:9 aspect ratio. Used for `continueWatching` and `upcomingForYou`.

Desktop width: 280px (≈158px tall). Fits ~4 across.
Mobile width: 220px (≈124px tall). Fits ~1.5 across.

**Always rendered:**

- Backdrop image from `item.backdrop`, with a landscape-cropped `item.poster` as fallback.
- Title below the card — 14px, weight 500, 1-line clamp.
- Row-specific detail line below the title.

**Conditional overlays:**

- **Progress bar** pinned to the bottom edge of the backdrop image (inside the image, not below it). 3px tall, full width. Background: 20% opacity (theme-aware); fill: `var(--color-text-danger)` (red, streaming-service idiom). Only on `continueWatching`.
- **Status pill** top-right — same rules as the poster card.
- **User rating** bottom-left — same rules as the poster card, but rendered **only when the progress bar is absent** (i.e. on `upcomingForYou`; the progress bar would collide with it on `continueWatching`).

**Row-specific detail line:**

- `continueWatching`: "22 min left" for movies, "S2 E4 · 22 min left" for TV. Computed from `progress.total - progress.watched` and, for TV, episode metadata already present on the item.
- `upcomingForYou`: "S2 E4 · Fri 9pm" from `item.episode.{season,episode,airsAt}`. `airsAt` formatted relative for near dates ("tomorrow"), weekday for this week ("Fri"), full date after.

### Shared rules

- Images always `loading="lazy"` + `decoding="async"`. No custom blur-up — a neutral background fill while loading is enough.
- Every card is rendered as an `<a href={`/media/${item.id}`}>`, not a `<button>`. Middle-click, Cmd/Ctrl-click, and "Open in new tab" work naturally. The click handler intercepts the default and updates the `peek` search param instead; modifier-clicks fall through to the real URL.
- Card component signature: `<Card item={...} rowId={...} />`. Internally dispatches via `ROW_DISPLAY[rowId].cardShape`. No other row-specific branching exists anywhere in the card code.
- Status pill, user rating, and match reason live in dedicated sub-components (`StatusPill`, `RatingBadge`, `MatchReason`) so both card variants render identically from the same primitives.

## Detail modal

Two surfaces, one body. The `peek` search param drives the overlay; the real route is the deep link.

### Trigger

- `<Card>`'s click handler calls `event.preventDefault()` and updates search: `router.navigate({ search: (prev) => ({ ...prev, peek: item.id }), replace: false })`. The explicit `replace: false` is load-bearing — TanStack Router's default for search updates is `replace: true`, which would not produce a history entry, and browser-back would skip past the modal open instead of dismissing it (see Implementation review notes).
- Middle-click, Cmd/Ctrl-click, and "Open in new tab" fall through to the native `<a href="/media/<id>">` — takes the user to the full-route page in a new context.
- The `peek` search param is validated via Zod on the route definition (`peekSchema` above). Invalid values are stripped by TanStack Router before they reach any component — no defensive parsing in the modal.

### Where the modal lives

At the `_authenticated` layout level, **not** the home route. Any authenticated route that sets `peek` in its search gets the modal for free. Two reasons:

- Future-proofs a `/search`, `/library`, or similar page without re-implementing the overlay.
- Opening a card from one page and navigating to another with the modal still intact would be fragile if each route owned its own modal instance.

The layout reads search via `useSearch({ strict: false })` so it can run under routes that don't declare `peek` in their schema without crashing.

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
  const close = () =>
    router.navigate({ search: (prev) => ({ ...prev, peek: undefined }) });

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

- Single component, two contexts. Takes `id` and `inModal`.
- `inModal: true` — no page-level header, no back button (the modal's close affordance handles dismiss), fits the dialog's width constraint.
- `inModal: false` — page-level header with a back button (`router.history.go(-1)`, or `/` as fallback when there's no history).
- The detail view's data model and layout are **out of scope for this spec** — a later doc owns media detail. The body is a placeholder interface here.

### Close behaviour

- Click outside the modal dismisses (shadcn Dialog default).
- `Escape` dismisses.
- Browser back dismisses. The card's open-transition navigate call uses `replace: false`, pushing a new history entry; the default `replace: true` on the close call rewrites it in place so dismissing doesn't pile a dead entry on top of the pre-modal URL. Net effect: one back-press goes from "modal open" to "home feed without peek," which is what users expect.
- The close button (top-right, `X` icon) dismisses.

All four paths route through the same `close()` function: clear the `peek` search param. Scroll position and row state are untouched because the home route never unmounted.

### Focus, scroll lock, accessibility

All handled by shadcn's `Dialog` primitive: focus trap, focus return to the triggering card on close, body scroll lock, `aria-modal`, proper labelling. No custom a11y code.

### Animations

shadcn Dialog's default fade + subtle scale. Nothing cinematic — cinematic open/close animations feel good at first and irritating by the third click.

## States

### First load (no cache)

While `home.getLayout` is in flight on a cold cache, render the skeleton layout: 4 skeleton rows (the common-case count), each with a narrow bar for the row title and ~6 card-shaped skeletons. Alternate skeleton card shape across the 4 rows (poster / backdrop / poster / backdrop) so the shimmering layout matches the eventual shape mix — a page that shimmers all-poster then settles into a mixed layout feels janky.

Use shadcn's `Skeleton` primitive. No custom shimmer animation.

### Revalidation (warm cache)

Cached layout renders immediately. tanstack-query's background refetch fires when stale (>60s) on focus. No spinner; no layout shift — if the refetched response has the same row set, cards update in place; if it doesn't, rows appear / disappear through normal React reconciliation.

### Empty layout (`rows: []`)

Happens for users with no connections and no admin-configured TMDB shared credentials. Centered layout, max-width ~420px:

- Title (h2, 18px, weight 500): "Nothing to show yet."
- Body (muted): "Connect a service to start seeing your media."
- Primary button: `Connect a service →` linking to `/connections`.

No illustration, no icon — matches the typography-driven tone of `/connections` and `/taste`.

### Full fetch error (`home.internal` or network)

Same centered layout as empty state, different copy:

- Title: "Couldn't load your home feed."
- Body: "Something went wrong. Give it a moment and try again."
- Primary button: `Retry` — calls tanstack-query's `refetch()`.

No raw error message shown. Error capture happens server-side per the error-management spec; the client just offers retry.

### Partial row indicator

When `HomeRow.partial === true`, render a small muted icon (`lucide-react` `AlertTriangle`, 14px, `--color-text-tertiary`) to the right of the row title, with a shadcn `Tooltip`: "Some sources didn't respond — showing what we could fetch."

Ambient, not intrusive. No top-level banner, no toast. The row renders its cards normally. Users who care can hover; users who don't won't notice.

### Row unavailable mid-session (`home.row_unavailable`)

Happens when the user disconnects a plugin while sitting on the page. `useRowPagination` catches the error and signals its parent to remove the row from local state. A single shadcn `Toast` fires: "{Row title} is no longer available." No retry affordance — the row genuinely can't be fetched anymore; a full page reload gets a fresh layout.

### Empty-retained row (`upcomingForYou` + `ok_empty`)

The one row the backend keeps when empty. Render the row header as normal; in the card area, render a single muted line:

- "You're all caught up on upcoming episodes."

Centered vertically in the row's card-area height. No card, no action button.

### End of row (cursor `null`, scrolled to end)

No visual indicator. The row just ends; `Next` arrow disables. No "That's all" text — ends speak for themselves.

### Loading more (cursor not null, fetch in flight)

Single skeleton card at the end of the row. Replaced by real cards on success, removed on failure without inline error.

## Responsive treatment

Breakpoints follow the existing Tailwind convention: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px).

### Card dimensions

| Viewport | Poster (width × height) | Backdrop (width × height) |
| -------- | ----------------------- | ------------------------- |
| `xl`+    | 180 × 270               | 280 × 158                 |
| `lg`     | 160 × 240               | 250 × 141                 |
| `md`     | 140 × 210               | 220 × 124                 |
| `<md`    | 128 × 192               | 220 × 124                 |

Card heights auto-derive from aspect ratio — these are driving widths, not fixed pixel boxes. Implemented via Tailwind responsive prefixes on a `flex-basis` class.

### Row gutters and page padding

- Gap between cards in a row: 12px desktop, 8px mobile.
- Page horizontal padding: 24px desktop (`md`+), 16px mobile.
- Row scroll area extends past the right page padding so the last visible card is partially cut off — signals "more to scroll" visually. Implemented with negative margin + corresponding padding inside the row's scroll container.

### Arrows

Hidden on touch-primary devices via `@media (hover: none)`. User-agent sniffing is forbidden — the hover media query is the correct signal. Keyboard users on touch devices (rare but real) still reach cards via Tab.

### Modal → full-screen on mobile

shadcn `Dialog` doesn't auto-go-fullscreen on mobile. Override via responsive classes on `DialogContent`:

- `sm:max-w-3xl max-h-[90vh]` on desktop (scrollable dialog).
- Below `sm`: `w-full h-[100dvh] max-w-none max-h-none rounded-none` — covers the viewport. The close button stays top-right.

Use `100dvh` (not `100vh`) so iOS Safari's address-bar collapse/expand doesn't cause layout jumps.

### Typography sizing

- Row titles: 15px on all viewports. Already compact; shrinking further muddies hierarchy.
- Card title: 14px desktop, 13px mobile.
- Card metadata (year, episode line, match reason): 12px desktop, 11px mobile.

### Touch interactions

- Drag-to-scroll: native (embla's pointer handling).
- Tap-to-open: `<a>` click.
- Momentum scroll: rely on embla's inertia; don't tune.

### What doesn't change responsively

- Status pills, user rating badges, and progress bars keep the same absolute pixel size. They're already small; scaling down per breakpoint makes them unreadable.
- Row count and order: identical across viewports. The layout rule table is server-side; responsive is a pure presentation concern.

## Testing

Follows the existing `vp test` harness and patterns from the `/connections` tests.

### Component tests

One file per component, colocated.

- `row-carousel.test.tsx`: embla initializes with the expected config; `Previous` disabled at scroll start; `Next` disabled when at end AND cursor is null; arrows hidden without hover, revealed with row focus; pagination callback fires at the 75% scroll threshold, debounced; keyboard arrow navigation scrolls to keep focus in view.
- `card.test.tsx`: dispatches to `CardPoster` for a `poster` rowId, `CardBackdrop` for a `backdrop` rowId, with no other branches reachable.
- `card-poster.test.tsx`: title + year always rendered; status pill rendered for `requested` / `processing` / `unavailable`, **not** rendered for `available` / `unknown`; user rating badge rendered when `userRating` is present; match reason rendered only when `ROW_DISPLAY[rowId].showMatchReasonInline && item.matchReason`.
- `card-backdrop.test.tsx`: progress bar rendered on `continueWatching` with width matching `progress.watched / progress.total`; episode detail line rendered on `upcomingForYou` with a formatted airdate; user rating badge placed bottom-left only when the progress bar is absent.
- `status-pill.test.tsx`: semantic color per status value; visually-hidden text for screen readers ("Status: Requested").
- `media-detail-modal.test.tsx`: opens when `peek` search param is a valid `MediaId`; closes on Escape / outside click / close button, navigating with `peek: undefined`; malformed `peek` values (failing the regex) do not open the modal.
- `home-feed-skeleton.test.tsx`: renders 4 rows with alternating poster/backdrop skeleton shapes.
- `home-feed-empty.test.tsx`: renders the CTA with a working link to `/connections`.
- `home-feed.test.tsx`: branches correctly on loading / empty / content / error.

### Hook tests

- `use-home-layout.test.ts`: fetches `home.getLayout`, caches under `["home", "layout"]`, revalidates in background after 60s stale; error state populated on `home.internal`.
- `use-row-pagination.test.ts`: initial items read from `HomeRow.items`; `fetchNext` appends on success; terminal cursor (`null`) sets `hasMore = false`; `home.row_unavailable` triggers the row-removal callback; partial failures during scroll-fetch silently drop the skeleton card without inline error.

### Integration tests

(`testing-library` + mocked oRPC client)

- Full page render with a fixture `HomeLayoutResponse` (mix of rows, one with `partial: true`, one with `upcomingForYou` + `ok_empty`).
- Click card → modal opens, URL shows `?peek=movie:550`, home page still mounted underneath.
- Close modal via each path: Escape, outside click, close button, browser back — all clear the `peek` search param and return focus to the triggering card.
- Direct-render of `/media/movie:550` as a full route — `MediaDetailBody` mounts without modal wrapping.
- Scroll a row past 75% → `getRowContent` called with the correct `rowId` and cursor; appended items render.
- Row with `partial: true` → muted icon next to title; tooltip copy correct on hover.
- `rows: []` → empty state renders with a working `/connections` link.
- `getLayout` throws → error state renders with a working Retry button.
- Touch media query mocked on (`hover: none`) → row arrow buttons not rendered; drag still works.

### Not tested here

- `HomeFeedService` behavior, row fetchers, capability aggregation — server test suite.
- `MediaDetailBody` content rendering — covered by the later media detail spec.
- TMDB image proxy behaviour — infrastructure.
- Plugin runtime / sandbox — plugin-runtime tests.
- Visual regression screenshots — add when the UI stabilizes; out of v1.

## Open questions / deferred

- **Hero / billboard unit.** Additive when the backend ships `layout.hero`. Frontend change is a new top-slot component; nothing else needs to move.
- **Netflix-style hover preview card** (expand on hover, reveal rating / cast / action buttons). Genuine work — preview component, timing logic, touch fallback. Deferred to v2. Revisit if users ask for it.
- **Horizontal row scroll restoration across full-page navigation.** Not preserved in v1 (vertical is, via TanStack Router default). If users complain after clicking a card into `/media/$id` and losing their place in a row on back, stash per-row `scrollLeft` in a Zustand store keyed on `rowId`.
- **Prefetch media detail on card hover.** Worth a few ms of perceived latency. Low effort (tanstack-query `prefetchQuery`). Deferred only because `MediaDetailBody`'s data spec isn't written yet.
- **"Tap to retry" on failed pagination.** A failed `getRowContent` silently drops the skeleton card today. On mobile especially, a one-tap retry affordance would help. Low priority — cold cache covers the common case.
- **Progressive row loading (SSE).** Backend open question; their spec notes per-row SSE is a clean retrofit. Frontend would need `useHomeLayout` to accept streamed rows. No work until the backend ships it.
- **Row-level user preferences** (hide Trending, pin Continue Watching). All ordering lives server-side in `rules.ts`. If we want user overrides, it's a server feature first.
- **Impression / engagement telemetry.** Explicitly not built, matching the PreferenceEngine spec's "no things-we-showed-this-user tracking" stance. Don't add ad-hoc.
- **Visual regression tests.** Not worth automating until card visuals stabilize. Add when a change breaks a subtle layout we didn't catch.
- **Keyboard shortcuts** (`/` for search, `j/k` between rows). Nice-to-have; no search page to hook `/` to yet.
- **Media detail body spec.** Referenced throughout this doc as a placeholder — its own spec is a prerequisite for actually shipping the modal.
- **Embla replacement.** If `dragFree` + keyboard behaviour ever fights us at edges, `keen-slider` is the obvious swap. No signal it will.

## Implementation review notes (2026-04-23)

The following load-bearing details were surfaced during design review and must be resolved by the implementing PR for each section. They are not changes to the design — they are clarifications that any agent picking up the work needs to handle.

- **Modal history (push vs replace).** TanStack Router's default for search updates is `replace: true`. For browser-back to dismiss the modal, the `peek` open transition must explicitly opt in to push. The dismiss transition can replace.
- **`useSearch({ strict: false })` does not validate.** With `strict: false`, the layout-level modal receives raw search params. Either declare `peek` on the `_authenticated` layout's search schema (so all child routes inherit it), or re-validate via `peekSchema.safeParse` inside the modal. Pick one and document it.
- **Cross-component row-removal mechanism.** `useRowPagination` catches `home.row_unavailable` and "signals the parent." The mechanism — callback prop from `HomeFeedContent` → `Row` → `useRowPagination`, or a shared reducer keyed on `rowId` — is left to the implementer; whichever is chosen must keep the Row component agnostic of layout-level state.
- **Tab-order through arrow buttons.** As written, every row's Previous/Next arrows are in the Tab sequence. With seven rows that's 14 extra tab stops before keyboard users reach any card via Tab. Reconsider: arrows out of Tab order, focusable via the standard carousel pattern (cards in Tab order; ArrowLeft/ArrowRight on focused cards). Arrows remain SR-discoverable via role/label.
- **Skeleton card shape ratio.** The "alternate poster/backdrop across 4 rows" rule produces the exact shimmer-then-settle jank it tries to avoid for the plugin-less common case (which is all posters). Either always poster, or match the row mix expected for the user's most likely layout.
- **`home-feed-error.tsx` and `home-feed-empty.tsx` overlap.** Both are "centered title + body + action button." Implement once as a `CenteredState` primitive and use it from both, rather than two near-identical files.
- **Row error boundary.** A single bad item or unhandled card render error should not crash the whole feed. Wrap each `Row` in an error boundary that hides only that row.
- **`@media (hover: none)` + keyboard on touch devices.** iPad with a keyboard matches `(hover: none)` and supports Tab. Make the arrow visibility rule consistent with the Tab-order decision above; do not produce invisible tab stops.
- **Progress bar color token.** `--color-text-danger` is a text color used on a non-text surface. Either introduce a dedicated `--color-progress-watched` token or pick a non-text role.
- **`@ent-mcp/shared/home` subpath export.** The backend spec mandates this; if the spec landed before the export, coordinate. The foundations sub-issue owns this check.

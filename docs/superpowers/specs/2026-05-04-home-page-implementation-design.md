# Home Page Implementation Design

**Date:** 2026-05-04  
**Status:** Approved  
**Reference prototype:** `/Users/omidastaraki/Code/Personal/nama-prototype`

---

## Goal

Port the home page design from the `nama-prototype` demo into the `@ent-mcp/client` app. Initial phase uses mock data only (no backend integration). Implementation is split into five independently mergeable PRs.

---

## Architecture

### Directory layout

```
apps/client/src/
├── features/home/
│   ├── components/
│   │   ├── card/
│   │   │   ├── index.tsx              — orchestrator; switches hero vs normal layout
│   │   │   ├── card-image.tsx         — aspect-ratio container, skeleton, clear logo
│   │   │   ├── card-meta.tsx          — title, year, rating, runtime row
│   │   │   ├── card-badges.tsx        — availability status + quality tags (4K, HDR)
│   │   │   ├── card-match-reason.tsx  — match reason chip
│   │   │   └── card-actions.tsx       — Request + watchlist buttons
│   │   ├── row/
│   │   │   ├── index.tsx              — horizontal carousel + infinite mock pagination
│   │   │   └── row-skeleton.tsx       — skeleton placeholder cards
│   │   ├── top-zone/
│   │   │   ├── index.tsx              — hero section root
│   │   │   ├── top-zone-ambient.tsx   — background parallax images
│   │   │   └── top-zone-hero-card.tsx — hero card overlay content
│   │   └── home-feed.tsx              — assembles TopZone + Row[]; renders MediaDetailModal
│   ├── hooks/
│   │   └── use-home-feed.ts           — returns HomeFeedData (mock now; TanStack Query later)
│   ├── lib/
│   │   ├── types.ts                   — all domain types (MediaItem, RowData, HeroItem, etc.)
│   │   ├── mock-data.ts               — ported from prototype's data.jsx
│   │   └── home-feed-config.ts        — row ordering, display copy, match reason key→text map
│   └── index.ts                       — barrel: exports HomeFeed
│
├── shared/components/
│   └── media-detail-modal/
│       ├── index.tsx                  — modal root + scroll engine
│       ├── modal-header.tsx           — title, metadata, clear logo
│       ├── modal-actions.tsx          — request, watchlist, trailer buttons
│       └── modal-seasons.tsx          — season/episode accordion for TV items
│
└── app/
    ├── top-nav.tsx                    — add Home/Library/Watchlist tabs (desktop)
    └── bottom-nav.tsx                 — new; Home/Library/Watchlist pill (mobile)
```

### Fallow zone additions (`.fallowrc.json`)

One new zone:

```json
{
  "name": "client-feat-home",
  "pattern": "apps/client/src/features/home/**",
  "allow": ["client-shared-*", "shared-pkg"]
}
```

`media-detail-modal` is covered by the existing `client-shared-components` zone — no new zone needed.

---

## Types (`features/home/lib/types.ts`)

```typescript
type MatchReasonKey =
  | "matches_recent_picks" | "from_genre_you_love" | "similar_to_seed"
  | "because_in_watchlist" | "continuing_series" | "upcoming_release"
  | "recently_added" | "highly_rated" | "from_active_series" | "finishing_soon"

type RowKind =
  | "continue_watching" | "because_you_finished" | "next_episode_active_series"
  | "tv_needs_request" | "movies_needs_request" | "watchlist_now_available"
  | "upcoming_for_you"

type MediaItem = {
  id: string
  kind: "movie" | "tv"
  title: string
  year?: number
  image: { "16/9"?: string; "2/3"?: string }
  clearLogo?: { type: "wordmark"; text: string }
  progress?: {
    percent: number; ratio: number; timeLeftSec: number
    watchedCount: number; totalCount: number; lastWatchedAt: string
  }
  availability: {
    hasAnyServerCopy: boolean
    requestEligible: boolean
    servers: { id: string; label: string }[]
  }
  seriesContext?: { season: number; episode: number; episodeTitle: string; nextUpFromServer: boolean }
  facets: { runtimeMin?: number; episodeCount?: number; monochrome?: boolean; releaseDate?: string }
  matchReasonKey?: MatchReasonKey
  matchReasonParams?: Record<string, string>
  rating?: string; overview?: string; cast?: string[]
  tags?: string[]; genres?: string[]; ageRating?: string; runtime?: string
  trailerUrl?: string; episode?: string; relDate?: string
  audienceScore?: number; criticScore?: number; votes?: number
}

type HeroItem = MediaItem & { alternates: MediaItem[] }

type RowData = {
  id: string
  kind: RowKind
  seedTitle?: string
  partial?: boolean
  items: MediaItem[]
  defaultAspect: "16/9" | "2/3"
}

type HomeFeedData = { hero: HeroItem; rows: RowData[] }
```

---

## Data flow

```
useHomeFeed() → HomeFeedData
    ↓
HomeFeed
  ├── TopZone        ← hero: HeroItem
  ├── Row[]          ← rows: RowData[]
  │    └── Card[]    ← item: MediaItem, rowKind: RowKind
  │         └── onClick → navigate({ search: { peek: item.id } })
  └── MediaDetailModal ← peekId from useSearch().peek
```

**Peek state** — TanStack Router search param (`?peek=<id>`). Browser back closes the modal for free. `MediaDetailModal` reads `peek` via `useSearch()` at the `HomeFeed` level.

**Watchlist + request state** — local `useState` in `HomeFeed` during mock phase, passed as context. Lifted to TanStack Query when backend is wired.

---

## UI implementation rules

- **Primitives:** shadcn components first. For headless/raw needs use Base UI. Never write custom primitives unless no alternative exists.
- **Tokens:** all color, spacing, radius, and shadow values must use existing CSS tokens from `globals.css`. If a required token is missing, stop and notify the developer — never approximate with a hardcoded value.
  - Demo's `--text-primary/secondary/tertiary` → `foreground` / `muted-foreground`
  - Demo's `--bg/--bg-2/--bg-3` → `background` / `card` / `muted`
  - Demo's `--accent-strong` → `primary`
  - Demo's `--accent-bg` → `accent` with opacity modifier
  - Demo's `--success` → `success` (token exists in `globals.css`)
  - Progress bar color → `progress-watched` (token exists)
- **Styling:** Tailwind CSS throughout. Inline styles only for dynamic values (scroll-driven animation progress percentages).
- **Logical properties:** use Tailwind v4 logical utilities (`ps/pe`, `ms/me`, `rounded-s/e`, etc.) — never directional (`pl/pr`, `ml/mr`).
- **Skills to invoke:** `/shadcn`, `/clean-code`, `/frontend-design` when implementing.

### Existing shadcn components to reuse

| Need | Use |
|------|-----|
| Modal/overlay | `dialog.tsx` |
| Bottom sheet (mobile) | `drawer.tsx` or `sheet.tsx` |
| Horizontal scroll | `scroll-area.tsx` (Base UI primitive) |
| Skeleton placeholders | `skeleton.tsx` |
| Badges | `badge.tsx` |
| Buttons | `button.tsx` |
| Tabs (nav) | `tabs.tsx` |
| Collapsible seasons | `collapsible.tsx` |
| Avatar / image fallback | `avatar.tsx` |
| Tooltip | `tooltip.tsx` |

---

## Component decomposition rule

Any component exceeding ~150 lines or handling 3+ distinct UI concerns gets a `component-name/` directory with:
- `index.tsx` — thin orchestrator
- Named sub-files per concern

No barrel `index.ts` inside sub-directories (per V57). Only the feature-root `index.ts` re-exports the public surface.

---

## PR plan

| # | Branch | Deliverable | Key files | Changeset |
|---|--------|-------------|-----------|-----------|
| 1 | `home/scaffold` | Feature skeleton; blank home route | `features/home/lib/types.ts`, `mock-data.ts`, `home-feed-config.ts`, `hooks/use-home-feed.ts`, stub `home-feed.tsx`, `index.ts`, `.fallowrc.json` (`client-feat-home`), route `index.tsx` | `@ent-mcp/client` minor |
| 2 | `home/nav-chrome` | `BottomNav` + `TopNav` tabs | `app/bottom-nav.tsx` (new), `app/top-nav.tsx` (tab additions), active state via `useRouterState` | `@ent-mcp/client` minor |
| 3 | `home/card-row` | Browsable feed with all 7 rows | `features/home/components/card/*`, `row/*`, `home-feed.tsx` wired | `@ent-mcp/client` minor |
| 4 | `home/top-zone` | Hero section complete | `features/home/components/top-zone/*`, wired into `home-feed.tsx` | `@ent-mcp/client` minor |
| 5 | `home/detail-modal` | Click-through detail modal | `shared/components/media-detail-modal/*`, `HomeFeed` renders modal, route gets `peek` search schema | `@ent-mcp/client` minor |

**Merge order:** PR 1 first → PRs 2, 3, 4 in any order (all depend only on PR 1) → PR 5.

---

## Testing

Tests colocate per V58: `features/home/__tests__/` for feature components, `shared/components/media-detail-modal/__tests__/` for the modal. Vitest + React Testing Library.

### Card
- Renders correct aspect ratio (16/9 vs 2/3)
- Progress bar present when `progress` prop set
- Correct badge per availability status
- Match reason chip present when `matchReasonKey` set
- Hero layout renders expected elements
- **a11y:** image has accessible name; request and watchlist buttons have `aria-label`

### Row
- Renders all items from `items` array
- Skeleton renders during loading state
- `partial` flag surfaces visual indicator
- **a11y:** scroll container keyboard-navigable; row has visible heading

### TopZone
- Renders title, year, rating from hero item
- Alternates list renders correct count
- **a11y:** no focus traps in ambient layer

### MediaDetailModal
- Renders when `peekId` set; hidden otherwise
- Escape key closes modal
- Focus trap active when open (`role="dialog"`, `aria-modal="true"`, focus returns to trigger on close)
- Season accordion renders for TV items
- **a11y:** `aria-labelledby` points to modal heading

### Navigation (BottomNav + TopNav tabs)
- Active item has `aria-current="page"`
- All items keyboard-reachable

### `use-home-feed`
- Returns `hero` + 7 rows with correct `kind` values
- No missing required fields on `MediaItem`

---

## Constraints honoured

- **V51–V60:** `features/home/` dir + `client-feat-home` fallow zone added together in PR 1. No sibling-feature imports.
- **V57:** No barrel `index.ts` inside sub-directories.
- **V58:** Tests colocate inside feature `__tests__/` dir.
- **C12:** Routes stay thin; all business logic inside feature.
- **C11:** Any utility code (array ops, string ops) uses `es-toolkit` submodule imports.
- **C14/V61:** Any translatable copy extracted to `messages/{en,fa}.json`; no inline string literals for UI copy.

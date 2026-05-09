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
│   │   ├── types.ts                   — HomeMediaItem (local UI type), HomeFeedData, HeroItem
│   │   ├── mock-data.ts               — ported from prototype's data.jsx
│   │   └── home-feed-config.ts        — ROW_ASPECT, ROW_COPY, MATCH_REASON_COPY
│   └── index.ts                       — barrel: exports HomeFeed
│
├── shared/components/
│   ├── media-meta-row.tsx             — shared year/runtime/age/rating/genres row (used by hero card + modal header)
│   └── media-detail-modal/
│       ├── index.tsx                  — modal root + scroll engine
│       ├── types.ts                   — local MediaDetailItem type (extends shared CompactMediaItem)
│       ├── modal-header.tsx           — title, metadata, clear logo
│       ├── modal-actions.tsx          — request stub, watchlist toggle, trailer stub
│       ├── modal-backdrop.tsx         — hero-area backdrop image with gradient fade
│       ├── modal-credits.tsx          — director / cast definition list
│       └── modal-seasons/             — TV-only seasons accordion (rev 2 amendment)
│           ├── index.tsx               — Suspense boundary + section frame
│           ├── seasons-list.tsx        — wraps RequestableSeasons (pluginConfigured=false)
│           ├── use-season-availability.ts — useSuspenseQuery → /api/home/season-availability
│           ├── derive-status.ts        — best-of-N season-status reducer
│           └── seasons-error.tsx       — ErrorBoundary fallback microcopy
│
└── app/
    ├── top-nav.tsx                    — add Home/Library/Watchlist tabs (desktop)
    └── bottom-nav.tsx                 — new; Home/Library/Watchlist pill (mobile)
```

### Fallow zone additions (`.fallowrc.json`)

PR 1 adds `client-feat-home` zone and updates two allow lists:

```jsonc
// zones[] — add:
{ "name": "client-feat-home", "patterns": ["apps/client/src/features/home/**"] }

// rules[] — add new rule:
{
  "from": "client-feat-home",
  "allow": ["client-shared-ui", "client-shared-components", "client-shared-hooks", "client-shared-lib", "shared-pkg"]
}

// rules[] — update "from": "client-routes" allow list, append:
"client-feat-home"

// rules[] — update "from": "client-root" allow list, append:
"client-feat-home"
```

`media-detail-modal` is covered by the existing `client-shared-components` zone — no new zone needed.

---

## Types (`features/home/lib/types.ts`)

`RowKind` is imported from `@ent-mcp/shared/home` — **never redefined locally**. The shared enum is the single source of truth.

```typescript
import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
export type { RowKind };

export const MATCH_REASON_KEYS = [
  "matches_recent_picks",
  "from_genre_you_love",
  "similar_to_seed",
  "because_in_watchlist",
  "continuing_series",
  "upcoming_release",
  "recently_added",
  "highly_rated",
  "from_active_series",
  "finishing_soon",
] as const;

export type MatchReasonKey = (typeof MATCH_REASON_KEYS)[number];
```

The shared `ROW_KINDS` tuple (`continueWatching`, `recommendedForYou`, `trendingNow`, `newReleases`, `becauseYouWatched`, `upcomingForYou`, `yourWatchlist`) determines which rows exist. Mock data maps the prototype's demo rows to these kinds:

| Demo row                                    | Shared RowKind                       |
| ------------------------------------------- | ------------------------------------ |
| `continue_watching`                         | `continueWatching`                   |
| `because_you_finished`                      | `becauseYouWatched`                  |
| `next_episode_active_series`                | `continueWatching` (second instance) |
| `tv_needs_request` / `movies_needs_request` | `recommendedForYou`                  |
| `watchlist_now_available`                   | `yourWatchlist`                      |
| `upcoming_for_you`                          | `upcomingForYou`                     |

`HomeMediaItem` is a **local UI-layer type** that extends `CompactMediaItem` with display fields absent from the wire format. At backend integration time an adapter `toHomeMediaItem(item: CompactMediaItem): HomeMediaItem` handles the mapping.

```typescript
import type { CompactMediaItem } from "@ent-mcp/shared/home";

// `CompactMediaItem.clearLogo` is a URL string (artwork image).
// `clearLogoText` carries the wordmark text used by the prototype's CSS logo treatment.
export type HomeMediaItem = CompactMediaItem & {
  clearLogoText?: string;
  availability?: {
    hasAnyServerCopy: boolean;
    requestEligible: boolean;
    servers: { id: string; label: string }[];
  };
  seriesContext?: {
    season: number;
    episode: number;
    episodeTitle: string;
    nextUpFromServer: boolean;
  };
  facets?: {
    runtimeMin?: number;
    episodeCount?: number;
    monochrome?: boolean;
    releaseDate?: string;
  };
  /**
   * Same value set as `CompactMediaItem.matchReason` from the wire format.
   * `toHomeMediaItem` maps: `matchReasonKey = item.matchReason ?? undefined`.
   * Mock data sets this directly. Valid values: see MATCH_REASON_KEYS below.
   */
  matchReasonKey?: MatchReasonKey;
  matchReasonParams?: Record<string, string>;
  tags?: string[];
  ageRating?: string;
  runtime?: string;
  trailerUrl?: string;
  relDate?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  cast?: string[];
  director?: string;
};

export type HeroItem = HomeMediaItem & { alternates: HomeMediaItem[] };

export type RowData = {
  id: string;
  kind: RowKind;
  seedTitle?: string;
  partial?: boolean;
  items: HomeMediaItem[];
  /** Derived client-side via ROW_ASPECT in home-feed-config.ts — not present in the wire format. */
  defaultAspect: "16/9" | "2/3";
  /**
   * Optional UI-only header override. When two rows share the same `kind`
   * (e.g. two `continueWatching` rows representing different intents), pass
   * a distinct Paraglide message key so the headings stay readable.
   */
  headerKey?: MessageKey;
  /** Optional subtitle override paired with `headerKey`. */
  subtitleKey?: MessageKey;
};

/**
 * `hero` is `HeroItem | null`. In the mock phase the mock always supplies a hero;
 * `HomeFeed` treats `null` as an unrecoverable data error and throws via `invariant`.
 * At backend integration time `null` means the server had no suitable hero candidate —
 * `HomeFeed` should render the feed without a TopZone.
 */
export type HomeFeedData = { hero: HeroItem | null; rows: RowData[] };
```

---

## `home-feed-config.ts`

Provides three client-side lookup maps — no runtime deps:

```typescript
import type { RowKind } from "@ent-mcp/shared/home"

/** Drives card image ratio for each row. Not present in the wire format. */
export const ROW_ASPECT: Record<RowKind, "16/9" | "2/3"> = {
  continueWatching:  "16/9",
  upcomingForYou:    "16/9",
  recommendedForYou: "2/3",
  becauseYouWatched: "2/3",
  trendingNow:       "2/3",
  newReleases:       "2/3",
  yourWatchlist:     "2/3",
}

/** Row header copy. Values are i18n message keys resolved via `m.<key>()`. */
export const ROW_COPY: Record<RowKind, { headerKey: string; subtitleKey?: string }> = { ... }

/** Match-reason chip copy. Parameterised via Paraglide ICU placeholders. */
export const MATCH_REASON_COPY: Record<string, (params: Record<string, string>) => string> = { ... }
```

---

## Data flow

```
useHomeFeed() → HomeFeedData
    ↓
HomeFeed
  ├── TopZone        ← hero: HeroItem
  ├── Row[]          ← rows: RowData[] (defaultAspect from ROW_ASPECT)
  │    └── Card[]    ← item: HomeMediaItem, rowKind: RowKind
  │         └── onClick → navigate({ search: { peek: item.id } })
  └── MediaDetailModal ← peekId from useSearch().peek
```

**Peek state** — TanStack Router search param (`?peek=<id>`). Schema reuses the **existing** `peekSchema` and `PeekSearch` from `@/lib/home-display.ts` (already defined). The route file `routes/_authenticated/_app/index.tsx` declares `validateSearch: peekSchema`. `HomeFeed` and `MediaDetailModal` read the validated value via `useSearch()` — **neither imports `peekSchema` directly** (that would cross a `client-feat-home` → `client-features-legacy` boundary). Only the route file imports `peekSchema`.

**Watchlist + request state** — local `useState` in `HomeFeed` during mock phase, passed as context. Lifted to TanStack Query when backend is wired.

---

## Error surface

The home subsystem ships a typed error taxonomy so the page-level boundary
maps server failures to distinct fallback copy + recovery affordances.

**`HomeApiError`** (`lib/types.ts`) — thrown by every fetcher in `lib/fetchers.ts`
when the response is not `ok`. Carries:
- `status: number` — HTTP status
- `body: ApiErrorBody | null` — decoded error envelope from
  `apps/server/src/errors/middleware.ts` (`code`, `message`, `devMessage`,
  `params`, `requestId`)
- `code: string | undefined` — convenience accessor for `body.code`
- `message` — `body.message ?? body.devMessage ?? "home request failed (<status>)"`

**`HomeErrorView`** (`lib/error-classification.ts`) — presentation-ready shape
produced by `classifyHomeError(error: Error)`:

```typescript
type HomeErrorVariant = "auth" | "offline" | "network" | "server" | "unknown";

interface HomeErrorView {
  variant: HomeErrorVariant;
  titleKey: MessageKey;       // Paraglide key, resolved via m[titleKey]()
  bodyKey: MessageKey;
  code: string;               // server-shipped or "client.unknown"
  status: number | null;
  devMessage: string | null;  // body.message ?? body.devMessage
  needsRelogin: boolean;      // true when variant === "auth"
}
```

**Classification order**:
1. **`offline`** — wins over everything when `navigator.onLine === false` or
   the error is a non-`HomeApiError` `TypeError` / `NetworkError`.
   Connectivity is the user's first blocker; a 401 thrown while offline
   resolves as `offline` (not `auth`) so they fix the network before
   re-attempting.
2. **`auth`** — `status` 401 / 403, or `code` ∈ {`http.unauthorized`,
   `http.forbidden`, `plugin.token_expired`, `plugin.bad_credentials`}.
3. **`network`** — `code` ∈ {`plugin.timeout`, `plugin.rate_limited`}.
4. **`server`** — `status` ≥ 500, or `code` ∈ {`home.internal`,
   `http.internal_error`}, or `code` starts with `plugin.upstream` /
   `plugin.pool_`.
5. **`unknown`** — everything else.

**Recovery affordances** (in `error-boundary.tsx`):
- `auth` → "Sign in again" (assigns `/login`) + "Try again" (resets queries)
- `server` → "Try again" + GitHub "Contact support" link
- `offline` / `network` / `unknown` → "Try again"

**Telemetry** — `FallbackInner` calls `reportError(error, "warning",
{ variant, requestId }, "client.home.boundary")` on mount. The shared
`ErrorBoundary.componentDidCatch` skips its own generic event when a
fallback is provided so feature boundaries own their telemetry path.

**Row-level errors** (`components/row/row-error.tsx`) live below the page
boundary and never bubble to it:
- `RowError` — full-row panel rendered when `useHomeRow` errors before any
  items arrive.
- `RowErrorInlineCard` — trailing card slot rendered at the end of the
  scroll track when `fetchNextPage` rejects after at least one page loaded.
  Retry calls `fetchNextPage` so the user retries just the failed page.

---

## UI implementation rules

- **Primitives:** shadcn components first. For headless/raw needs use Base UI. Never write custom primitives unless no alternative exists.
- **Tokens:** all color, spacing, radius, and shadow values must use existing CSS tokens from `globals.css`. If a required token is missing, stop and notify the developer — never approximate with a hardcoded value.
  - Demo's `--text-primary/secondary/tertiary` → `foreground` / `muted-foreground`
  - Demo's `--bg/--bg-2/--bg-3` → `background` / `card` / `muted`
  - Demo's `--accent-strong` → `primary`
  - Demo's `--accent-bg` → `accent` with opacity modifier
  - Demo's `--success` → `success` (token exists)
  - Progress bar color → `progress-watched` (token exists)
- **Styling:** Tailwind CSS throughout. Inline styles only for dynamic values (scroll-driven animation progress percentages).
- **Logical properties:** use Tailwind v4 logical utilities (`ps/pe`, `ms/me`, `rounded-s/e`, etc.) — never directional (`pl/pr`, `ml/mr`).
- **Skills to invoke:** `/shadcn`, `/clean-code`, `/frontend-design` when implementing.

### Existing shadcn components to reuse

| Need                    | Component                             |
| ----------------------- | ------------------------------------- |
| Modal/overlay           | `dialog.tsx`                          |
| Bottom sheet (mobile)   | `sheet.tsx`                           |
| Horizontal scroll       | `scroll-area.tsx` (Base UI primitive) |
| Skeleton placeholders   | `skeleton.tsx`                        |
| Badges                  | `badge.tsx`                           |
| Buttons                 | `button.tsx`                          |
| Tabs (nav)              | `tabs.tsx`                            |
| Collapsible seasons     | `collapsible.tsx`                     |
| Avatar / image fallback | `avatar.tsx`                          |
| Tooltip                 | `tooltip.tsx`                         |

---

## Component decomposition rule

Any component exceeding ~150 lines or handling 3+ distinct UI concerns gets a `component-name/` directory with:

- `index.tsx` — thin orchestrator
- Named sub-files per concern

No barrel `index.ts` inside sub-directories (per V57). Only the feature-root `index.ts` re-exports the public surface.

---

## PR plan

| #   | Branch              | Deliverable                                                  | Key files                                                                                                                                                                                                      | Changeset               |
| --- | ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | `home/scaffold`     | Feature skeleton; blank home route                           | `features/home/lib/types.ts`, `mock-data.ts`, `home-feed-config.ts`, `hooks/use-home-feed.ts`, stub `home-feed.tsx`, `index.ts`, `.fallowrc.json` (`client-feat-home` + allow list updates), route `index.tsx` | `@ent-mcp/client` minor |
| 2   | `home/nav-chrome`   | `BottomNav` + `TopNav` tabs; stub Library + Watchlist routes | `app/bottom-nav.tsx` (new), `app/top-nav.tsx` (add `TopNavLinks`), stub routes for `/library` and `/watchlist`, active state via `useRouterState`                                                              | `@ent-mcp/client` minor |
| 3   | `home/card-row`     | Browsable feed with all rows                                 | `features/home/components/card/*`, `row/*`, `home-feed.tsx` wired                                                                                                                                              | `@ent-mcp/client` minor |
| 4   | `home/top-zone`     | Hero section complete                                        | `features/home/components/top-zone/*`, wired into `home-feed.tsx`                                                                                                                                              | `@ent-mcp/client` minor |
| 5   | `home/detail-modal` | Click-through detail modal                                   | `shared/components/media-detail-modal/*`, `HomeFeed` renders modal, route registers `validateSearch: peekSchema`                                                                                               | `@ent-mcp/client` minor |

**Merge order:** PR 1 first → PRs 2, 3, 4 in any order → PR 5.

### PR 2 — TopNav scope detail

`TopNavLinks` is a new sub-component added to `top-nav.tsx`. It renders Home / Library / Watchlist links with the animated sliding active indicator from the prototype. `/library` and `/watchlist` are stub routes that return a `<ComingSoon />` placeholder — they exist so `useRouterState` has real paths to match against.

### PR 5 — DetailModal scope (mock phase)

In-scope:

- Hero layout: title, metadata, overview, cast, genres
- Action row (`modal-actions.tsx`): Request button (stub — fires local state), Watchlist toggle, Trailer button (stub — no-op)
- Season accordion (`modal-seasons/`): live TV-only read-only accordion (rev 2 amendment to home backend spec). Canonical season+episode list arrives w/ `home.getDetails`; per-server presence loaded lazily via `home.getSeasonAvailability` inside a `<Suspense>` boundary. Per-season status derived best-of-N across servers (available / partial / unavailable / upcoming). Reuses existing `RequestableSeasons` component w/ `pluginConfigured={false}` so request actions render as plain status badges. Plugin failure shows partial-success row + "couldn't reach <server>" microcopy via local `<ErrorBoundary>`. No request buttons yet.
- Scroll-driven title animation (CSS scroll-timeline)
- Focus trap, keyboard dismiss, `aria-modal`

Deferred to backend phase (out of scope for mock PRs):

- `FeedbackBar` (like/dislike + note)
- `NoteEditor`
- `TrailerOverlay`
- `MoreOptionsButton` / `RequestPickerPopover`
- Per-episode request UI

---

## i18n

**C14** (architecture): Paraglide i18n is client-only v1. No server use.

**V61** (implementation invariant): All UI copy imported via `m.<key>()` from `@/paraglide/messages`. Inline string literals for user-visible text are a spec violation.

Messages live in `messages/home/en.json` and `messages/home/fa.json` (by analogy with `messages/notifications/`).

Strings requiring i18n keys (all keys namespaced under `home_`):

| Key                                                                                                                                                                                                                                                                                                                                                                                             | Context                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `home_nav_home`, `home_nav_library`, `home_nav_watchlist`, `home_nav_brand_label`                                                                                                                                                                                                                                                                                                               | BottomNav + TopNav labels (incl. brand wordmark)     |
| `home_row_<rowKind>_header` (7 keys)                                                                                                                                                                                                                                                                                                                                                            | Row section headings                                 |
| `home_row_nextInYourShows_header`, `home_row_nextInYourShows_subtitle`, `home_row_tvShowsToRequest_header`, `home_row_moviesToRequest_header`                                                                                                                                                                                                                                                   | Per-row header overrides for duplicate `RowKind`s    |
| `home_match_reason_matches_recent_picks`, `home_match_reason_from_genre_you_love`, `home_match_reason_similar_to_seed`, `home_match_reason_because_in_watchlist`, `home_match_reason_continuing_series`, `home_match_reason_upcoming_release`, `home_match_reason_recently_added`, `home_match_reason_highly_rated`, `home_match_reason_from_active_series`, `home_match_reason_finishing_soon` | Match reason chip copy (ICU params where applicable) |
| `home_hero_play`, `home_hero_resume`, `home_hero_more_info`, `home_hero_progress_watched`                                                                                                                                                                                                                                                                                                       | Hero action buttons + progress label                 |
| `home_card_request`, `home_card_add_watchlist`, `home_card_remove_watchlist`                                                                                                                                                                                                                                                                                                                    | Card action labels                                   |
| `home_card_available`, `home_card_requested`, `home_card_unavailable`                                                                                                                                                                                                                                                                                                                           | Availability badge labels                            |
| `home_detail_request`, `home_detail_watchlist_add`, `home_detail_watchlist_remove`, `home_detail_trailer`                                                                                                                                                                                                                                                                                       | Detail modal actions                                 |
| `home_detail_season_available`, `home_detail_season_requested`, `home_detail_season_unavailable`, `home_detail_season_upcoming`                                                                                                                                                                                                                                                                 | Season status tags                                   |
| `home_row_partial_warning`                                                                                                                                                                                                                                                                                                                                                                      | Partial-source indicator                             |

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
- `partial` flag surfaces a visual indicator
- **a11y:** scroll container keyboard-navigable; row has visible heading

### TopZone

- Renders title, year, rating from hero item
- Alternates list renders correct count
- **a11y:** no focus traps in ambient layer

### MediaDetailModal

- Renders when `peekId` set; hidden otherwise
- Escape key closes modal
- Focus trap active when open (`role="dialog"`, `aria-modal="true"`, focus returns to trigger on close)
- Season accordion renders for TV items (read-only)
- **a11y:** `aria-labelledby` points to modal heading

### Navigation (BottomNav + TopNav tabs)

- Active item has `aria-current="page"`
- All items keyboard-reachable

### `use-home-feed`

- Returns `hero` + rows with correct `kind` values matching `ROW_KINDS`
- No missing required fields on `HomeMediaItem`

---

## Constraints honoured

- **V51–V60:** `features/home/` dir + `client-feat-home` zone + allow list updates all land in PR 1. No sibling-feature imports.
- **V57:** No barrel `index.ts` inside sub-directories.
- **V58:** Tests colocate inside feature `__tests__/` dir.
- **C12:** Routes stay thin; all business logic inside feature.
- **C11:** Any utility code (array ops, string ops) uses `es-toolkit` submodule imports.
- **C14 / V61:** All UI copy uses Paraglide `m.<key>()`. No inline string literals.
- **V12:** `RowKind` imported from `@ent-mcp/shared/home` — never redefined in client code.

# Auth Page Live Trending Posters — Design

**Date:** 2026-06-14
**Status:** Draft — pending review

## Summary

The login/auth page renders a decorative scrolling poster-grid background. Today
each card is a procedurally-generated gradient with overlaid title/tag text and a
brand mark — pure mock data, no real media. This design swaps that mock for **live
trending media posters**, with a bundled branded-art fallback so the page never
looks broken.

The grid layout, row structure, and scroll animation are unchanged. Only the data
source and the per-card rendering change.

## Goals

- Show real trending poster images on the auth-page background grid.
- Work for **unauthenticated** users (the auth page has no session).
- Keep the page robust: the grid is decorative and must never block or break login.
- Keep the change small and focused.

## Non-Goals

- No redesign of the grid layout, rows, or scroll animation.
- No personalization — the public feed is generic trending, identical for everyone.
- No new catalog/trending data pipeline — reuse the existing trending feed.

## Constraints

- The existing trending data paths are all auth-gated (`requireSession`):
  `GET /api/discover/trending`, `GET /api/media/sources/:sourceId`,
  `GET /api/home/layout`. The auth page cannot call them.
- TMDB poster images are copyrighted — fallback art bundled in the repo must be
  generic/branded, not real captured posters.

## Architecture

### 1. Server — public trending endpoint

Add a new public route:

```
GET /api/public/trending?limit=<n>
```

- **No `requireSession`.** Registered as its own public sub-app in the API router
  (sibling to the auth routes), so removing the guard does not expose any other
  procedure.
- Internally reuses the existing trending catalog feed — the same source that
  backs `discover/trending` and the `trendingNow` home row (movies + tv, mixed,
  popularity order). Served from that feed's existing daily cache; the endpoint
  does **no per-request catalog work**, which also bounds the cost of opening it
  to unauthenticated traffic.
- Returns a **minimal projection only** — no user-specific fields:

  ```ts
  // response
  { posters: { id: string; title: string; poster: string }[] }
  ```

  - `id` is the public catalog/media id (e.g. `"movie:550"`) — non-sensitive,
    identical for every user. It is included only as a stable React key. The
    response carries no facets, availability, overview, watch state, or any field
    derived from a user/session.
- Items without a `poster` URL are dropped.
- `limit` defaults to **48**, clamped to `[1, 96]`. Non-numeric, missing, zero, or
  negative input falls back to the default. The auth grid requests a full
  6 rows × 14 = **84** cards, so the `[1, 96]` ceiling sits above what the grid asks
  for while keeping the param meaningfully testable.
- The feed may return **fewer** than `limit` posterable items (after the
  no-`poster` filter). The endpoint returns whatever it has — it does not pad,
  repeat, or invent items. Filling the grid to a full card count is the client's
  responsibility (see below).
- The read is **side-effect-free**: it does not record metadata access, so
  anonymous traffic never mutates catalog state or keeps trending rows warm
  against pruning. The response carries
  `Cache-Control: public, max-age=300, stale-while-revalidate=3600` so a
  CDN/reverse proxy absorbs repeat login-page loads. There is intentionally
  **no per-IP rate limit** — a cached, side-effect-free read plus the cache
  header bounds repeat cost; an accepted trade-off for a decorative public
  endpoint, worth revisiting only if login-page traffic makes this path hot.

### 2. Client — fetch + render

- Add a public query in the auth feature (`apps/client/src/features/auth/`) that
  calls `GET /api/public/trending` **without a session**. Follow the existing
  feature-architecture conventions (query-keys factory, typed client call).
- The grid always renders a **fixed full card count** (6 rows × 14 = 84). Cards are
  filled in order from the live `posters[]`; any remaining slots (when the feed
  returns fewer than the full count, including the empty case) fall through to a
  programmatic branded placeholder. So a grid may legitimately be a **mix** of live
  posters and placeholders — that is acceptable and intended; the grid is never left
  short or blank. Live posters are unique among themselves (the feed is de-duplicated
  upstream); the placeholder fillers carry no titles or imagery.
- `PosterGridBackground` renders a real `<img>` per card:
  - `object-cover`, lazy loading.
  - **No title/tag/brand text overlay** — the poster art carries the title.
  - Per-card `onError` swaps that single image to a bundled fallback art asset,
    without affecting sibling cards.
- Grid layout, row composition, and scroll animation are untouched.

### 3. Fallback — programmatic branded placeholder

- Render a shared `PosterPlaceholder` component (no bundled image files, no TMDB
  imagery): a brand-tinted radial gradient with the app logo pressed into the
  surface as an emboss. The tint is varied per slot from a `seed` so a grid of
  placeholders reads as varied art rather than one repeated tile.
- Used when:
  - the endpoint errors,
  - the endpoint returns an empty list, or
  - an individual live image fails to load (`onError`).
- Fills every non-live slot, so the grid is always a full card count.
- This **replaces** the procedural-gradient mock imagery; the mock poster-data
  module (`apps/client/src/features/auth/lib/poster-data.ts`) is trimmed to the row
  geometry it still provides, and the old gradient/text styling is removed.

## Data Flow

```
login mount
  └─ GET /api/public/trending  (no session)
       ├─ success → fill grid cards in order from posters[];
       │            remaining slots → branded placeholder
       └─ error OR empty → all slots → branded placeholder
per-card <img> onError → drop that single image, revealing its placeholder
```

The grid always shows a full set of cards; live posters and placeholders may coexist.

The grid is a decorative background. The login form renders immediately and is
never gated on this request.

## Affected Code (indicative)

**Server**
- `apps/server/src/api/procedures/` — new `public.ts` (or similar) defining the
  public sub-app that hosts `/public/trending` (no `requireSession`).
- `apps/server/src/api/router.ts` — mount that public sub-app as a sibling of the
  auth-gated routers.
- Reuse existing catalog trending feed + the `CompactMediaItem` → minimal mapping.

**Client**
- `apps/client/src/features/auth/components/poster-grid-background.tsx` — render
  `<img>` over a `PosterPlaceholder` base layer, drop text overlay, add `onError`
  fallback.
- `apps/client/src/features/auth/` — new public query + query-key, wired to the
  grid. Trim `lib/poster-data.ts` to row geometry (mock imagery removed).
- `apps/client/src/shared/components/poster-placeholder.tsx` — shared programmatic
  placeholder (also usable as a poster loading skeleton).

**Shared**
- If a shared type is warranted for the minimal poster shape, add it under
  `packages/shared` per the shared-package rules. Otherwise keep it local to the
  public procedure.

## Error Handling

- Endpoint failure / empty → bundled-art grid (handled client-side; no error
  surfaced to the user, since the grid is decorative).
- Individual broken image → per-card `onError` fallback.
- Server endpoint returns `200` with an empty `posters` array rather than erroring
  when the trending feed is unavailable, so the client path stays simple.

## Testing

**Server**
- `/api/public/trending` returns the minimal shape and **does not require auth**
  (200 for a logged-out request).
- Respects `limit`; clamps to `[1, 96]`; non-numeric/zero/negative/missing → 48.
- Filters out items lacking a `poster` URL.
- Response contains only `{ id, title, poster }` — no facets, availability,
  overview, or any user/session-derived field.
- The public sub-app exposes **only** `/public/trending`; sibling/auth-gated
  procedures are not reachable through it.

**Client**
- Maps the response onto the grid (no text overlay) and fills remaining slots with
  cycled bundled art.
- Falls back to a full bundled-art grid on endpoint error and on empty response.
- Per-card `onError` swaps a single broken image to fallback without affecting
  siblings.
- The login form renders immediately and is **not gated** on the trending request
  (the grid is decorative; pending/failed fetch does not block the form).

## Open Questions

- None blocking. Exact fallback-art assets and the precise public-route module
  name are implementation details.

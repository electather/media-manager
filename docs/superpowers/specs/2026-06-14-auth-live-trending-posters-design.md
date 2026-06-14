# Auth Page Live Trending Posters — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

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
  popularity order).
- Returns a **minimal projection only** — no user-specific or sensitive fields:

  ```ts
  // response
  { posters: { id: string; title: string; poster: string }[] }
  ```

- Items without a `poster` URL are dropped.
- `limit` defaults to 48, clamped to a sane max (e.g. 48). The grid needs ~48 cards
  (6 rows × ~8); fetching ~48 means every card is a unique poster.
- Response is small and contains no facets, availability, overview, or IDs that
  leak user state.

### 2. Client — fetch + render

- Add a public query in the auth feature (`apps/client/src/features/auth/`) that
  calls `GET /api/public/trending` **without a session**. Follow the existing
  feature-architecture conventions (query-keys factory, typed client call).
- `PosterGridBackground` maps `posters[]` onto its existing grid cards and renders
  a real `<img>` per card:
  - `object-cover`, lazy loading.
  - **No title/tag/brand text overlay** — the poster art carries the title.
  - Per-card `onError` swaps the image to a bundled fallback art asset.
- Grid layout, row composition, and scroll animation are untouched.

### 3. Fallback — generic branded art

- Bundle a small set (~8–12) of abstract/branded placeholder poster images in the
  client assets. No real titles, no TMDB imagery.
- Used when:
  - the endpoint errors,
  - the endpoint returns an empty list, or
  - an individual live image fails to load (`onError`).
- Cycled across the grid slots to fill all cards.
- This **replaces** the procedural-gradient mock; the mock poster-data module
  (`apps/client/src/features/auth/lib/poster-data.ts`) and gradient styling are
  removed.

## Data Flow

```
login mount
  └─ GET /api/public/trending  (no session)
       ├─ success, posters non-empty → render <img> grid (unique live posters)
       └─ error OR empty           → render bundled branded-art grid
per-card <img> onError             → swap that card to bundled art
```

The grid is a decorative background. The login form renders immediately and is
never gated on this request.

## Affected Code (indicative)

**Server**
- `apps/server/src/api/procedures/` — new `public.ts` (or similar) procedure for
  `/public/trending`.
- `apps/server/src/api/router.ts` — register the public sub-app.
- Reuse existing catalog trending feed + the `CompactMediaItem` → minimal mapping.

**Client**
- `apps/client/src/features/auth/components/poster-grid-background.tsx` — render
  `<img>`, drop text overlay, add `onError` fallback.
- `apps/client/src/features/auth/` — new public query + query-key, wired to the
  grid. Remove `lib/poster-data.ts` mock.
- Client assets — add bundled branded fallback art.

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
- Respects `limit` and clamps it.
- Filters out items lacking a `poster` URL.
- Response contains no user-specific / sensitive fields.

**Client**
- Maps the response onto the grid (unique posters, no text overlay).
- Falls back to bundled branded art on endpoint error and on empty response.
- Per-card `onError` swaps a single broken image to fallback without affecting
  siblings.

## Open Questions

- None blocking. Exact fallback-art assets and the precise public-route module
  name are implementation details.

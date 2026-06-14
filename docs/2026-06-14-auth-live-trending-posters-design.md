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
- `limit` defaults to **48** (the grid needs ~48 cards = 6 rows × ~8), clamped to
  `[1, 96]`. Non-numeric, missing, zero, or negative input falls back to the
  default. The max sits above the default so the param is meaningfully testable.
- The feed may return **fewer** than `limit` posterable items (after the
  no-`poster` filter). The endpoint returns whatever it has — it does not pad,
  repeat, or invent items. Filling the grid to a full card count is the client's
  responsibility (see below).

### 2. Client — fetch + render

- Add a public query in the auth feature (`apps/client/src/features/auth/`) that
  calls `GET /api/public/trending` **without a session**. Follow the existing
  feature-architecture conventions (query-keys factory, typed client call).
- The grid always renders a **fixed full card count** (~48). Cards are filled in
  order from the live `posters[]`; any remaining slots (when the feed returns fewer
  than the full count, including the empty case) are filled with bundled branded
  art, cycled. So a grid may legitimately be a **mix** of live posters and fallback
  art — that is acceptable and intended; the grid is never left short or blank.
  Live posters are unique among themselves (the feed is de-duplicated upstream);
  the uniqueness guarantee does not extend to the cycled fallback fillers.
- `PosterGridBackground` renders a real `<img>` per card:
  - `object-cover`, lazy loading.
  - **No title/tag/brand text overlay** — the poster art carries the title.
  - Per-card `onError` swaps that single image to a bundled fallback art asset,
    without affecting sibling cards.
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
       ├─ success → fill grid cards in order from posters[];
       │            remaining slots → cycled bundled branded art
       └─ error OR empty → all slots → cycled bundled branded art
per-card <img> onError → swap that single card to bundled art
```

The grid always shows a full set of cards; live and fallback art may coexist.

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

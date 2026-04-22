---
"@ent-mcp/server": minor
---

Extend the plugin capability catalog and built-in plugin coverage.

New methods on existing capabilities:

- `watchHistory@v1.removeFromHistory` (Trakt)
- `ratings@v1.removeRating` (Trakt)
- `recommendations@v1.getAnticipated` (Trakt)
- `calendar@v1.getUpcomingMovies` (Trakt)
- `mediaRequest@v1.cancelRequest` (Seerr)

New capabilities:

- `watchProviders@v1` (TMDB) — streaming/rent/buy provider names per region.
- `trailers@v1` (TMDB) — trailer/teaser/clip videos per media item.
- `playback@v1` (Trakt) — cross-device resume positions.
- `collection@v1` (Trakt) — user's owned library, distinct from watchlist.

Plugins bumped: trakt 1.1.0 → 1.2.0, tmdb 2.0.0 → 2.1.0, seerr 1.2.0 → 1.3.0.

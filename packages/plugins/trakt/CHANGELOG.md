# @nama/plugin-trakt

## 0.2.4

### Patch Changes

- 37bc35e: Fixed Trakt token refresh treating rate-limit responses as expired credentials; the connection no longer flips to "reconnect required" when Trakt returns 429, and the per-connection job runner now honours the rate-limit cooldown before retrying.
- Updated dependencies [1b1c614]
- Updated dependencies [e38746e]
- Updated dependencies [68c85b3]
- Updated dependencies [adaf118]
  - @nama/plugin-sdk@0.5.0

## 0.2.3

### Patch Changes

- @nama/plugin-sdk@0.4.1

## 0.2.2

### Patch Changes

- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
  - @nama/plugin-sdk@0.4.0

## 0.2.1

### Patch Changes

- a31896c: Fixed several home-feed availability issues: items not on a connected server no longer falsely report "available" when Jellyfin's TMDB filter is unsupported, your Trakt watchlist no longer disappears when an item has a missing IMDB id, and watchlist titles you have on Jellyfin now render even before the catalog has cached their metadata.
- Updated dependencies [a31896c]
- Updated dependencies [2b70a07]
  - @nama/plugin-sdk@0.3.0

## 0.2.0

### Minor Changes

- e9b915f: Each built-in integration (Trakt, TMDB, TVDB, Seerr, Plex, Jellyfin) is now its own package, so each one can be released and tracked on its own.

### Patch Changes

- e92154f: Trakt syncing is more resilient: temporary Trakt outages no longer force you to re-authenticate, and malformed entries in your watchlist or ratings are skipped instead of crashing the request.
- Updated dependencies [986fb74]
- Updated dependencies [fc371c1]
- Updated dependencies [e9b915f]
- Updated dependencies [b55a04b]
- Updated dependencies [e9b915f]
- Updated dependencies [e340f9d]
  - @nama/plugin-sdk@0.2.0

# @nama/plugin-plex

## 0.3.4

### Patch Changes

- 4d13bfe: Fixed watch history leaking all server accounts' data when plexAccountId was not configured.
- 0a202a8: Fixed Plex setup now surfaces an error when the account ID cannot be retrieved, preventing a broken connection from being saved.
- Updated dependencies [3dae961]
  - @nama/plugin-sdk@0.6.0

## 0.3.3

### Patch Changes

- a740007: Fixed X-Plex-Token leaking to redirect targets by rejecting redirects in plexServerFetch.
- 08df5ef: Fixed Plex auth automatically trusting shared servers for URL population, preventing SSRF via attacker-controlled server connections.
- Updated dependencies [1b1c614]
- Updated dependencies [e38746e]
- Updated dependencies [68c85b3]
- Updated dependencies [adaf118]
  - @nama/plugin-sdk@0.5.0

## 0.3.2

### Patch Changes

- @nama/plugin-sdk@0.4.1

## 0.3.1

### Patch Changes

- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
  - @nama/plugin-sdk@0.4.0

## 0.3.0

### Minor Changes

- a31896c: Sped up the home feed: each library plugin now publishes a one-shot list of TMDB ids it has on hand, and the server uses that index for every availability check in a request instead of probing one title at a time.
- 2b70a07: Restored the season list to the TV detail modal with per-server episode availability across connected Plex and Jellyfin libraries.

### Patch Changes

- a31896c: Fixed the home feed so titles you watch on Jellyfin or Plex show up in the Continue Watching row and the hero, and so a card's "available on your server" state reflects what the server actually has rather than only what was requested through Seerr.
- Updated dependencies [a31896c]
- Updated dependencies [2b70a07]
  - @nama/plugin-sdk@0.3.0

## 0.2.0

### Minor Changes

- e9b915f: Each built-in integration (Trakt, TMDB, TVDB, Seerr, Plex, Jellyfin) is now its own package, so each one can be released and tracked on its own.

### Patch Changes

- Updated dependencies [986fb74]
- Updated dependencies [fc371c1]
- Updated dependencies [e9b915f]
- Updated dependencies [b55a04b]
- Updated dependencies [e9b915f]
- Updated dependencies [e340f9d]
  - @nama/plugin-sdk@0.2.0

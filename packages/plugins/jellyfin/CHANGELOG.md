# @ent-mcp/plugin-jellyfin

## 0.3.1

### Patch Changes

- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
  - @ent-mcp/plugin-sdk@0.4.0

## 0.3.0

### Minor Changes

- a31896c: Sped up the home feed: each library plugin now publishes a one-shot list of TMDB ids it has on hand, and the server uses that index for every availability check in a request instead of probing one title at a time.
- 2b70a07: Restored the season list to the TV detail modal with per-server episode availability across connected Plex and Jellyfin libraries.

### Patch Changes

- a31896c: Fixed the home feed so titles you watch on Jellyfin or Plex show up in the Continue Watching row and the hero, and so a card's "available on your server" state reflects what the server actually has rather than only what was requested through Seerr.
- a31896c: Fixed several home-feed availability issues: items not on a connected server no longer falsely report "available" when Jellyfin's TMDB filter is unsupported, your Trakt watchlist no longer disappears when an item has a missing IMDB id, and watchlist titles you have on Jellyfin now render even before the catalog has cached their metadata.
- Updated dependencies [a31896c]
- Updated dependencies [2b70a07]
  - @ent-mcp/plugin-sdk@0.3.0

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
  - @ent-mcp/plugin-sdk@0.2.0

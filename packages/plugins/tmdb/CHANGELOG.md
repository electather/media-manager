# @ent-mcp/plugin-tmdb

## 0.3.3

### Patch Changes

- a389685: Backdrops now prefer textless variants over language-tagged versions, so UI overlays no longer clash with text baked into the artwork.

## 0.3.2

### Patch Changes

- @ent-mcp/plugin-sdk@0.4.1

## 0.3.1

### Patch Changes

- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
  - @ent-mcp/plugin-sdk@0.4.0

## 0.3.0

### Minor Changes

- 2b70a07: Restored the season list to the TV detail modal with per-server episode availability across connected Plex and Jellyfin libraries.

### Patch Changes

- Updated dependencies [a31896c]
- Updated dependencies [2b70a07]
  - @ent-mcp/plugin-sdk@0.3.0

## 0.2.0

### Minor Changes

- 986fb74: Added the foundation for high-quality artwork on the home feed: TMDB now returns posters, backdrops, and clear logos through a new artwork capability that future plugins can extend.
- e9b915f: Each built-in integration (Trakt, TMDB, TVDB, Seerr, Plex, Jellyfin) is now its own package, so each one can be released and tracked on its own.

### Patch Changes

- db2b076: Fixed TMDB's discover capability so date-window and sort filters are honored, and the New Releases row now mixes movies and TV shows instead of returning movies only.
- Updated dependencies [986fb74]
- Updated dependencies [fc371c1]
- Updated dependencies [e9b915f]
- Updated dependencies [b55a04b]
- Updated dependencies [e9b915f]
- Updated dependencies [e340f9d]
  - @ent-mcp/plugin-sdk@0.2.0

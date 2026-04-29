# @ent-mcp/plugin-tmdb

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

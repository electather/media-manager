# @ent-mcp/plugin-sdk

## 0.2.0

### Minor Changes

- 986fb74: Added the foundation for high-quality artwork on the home feed: TMDB now returns posters, backdrops, and clear logos through a new artwork capability that future plugins can extend.
- fc371c1: Added a Netflix-style home feed with seven curated rows, hero pick, opaque-cursor pagination, and graceful row-level degradation when plugins are missing or slow.
- e9b915f: Reorganise the workspace so plugin authors have a single dedicated SDK to depend on. No user-visible behaviour change.
- e340f9d: Plugins can now deliver notifications via the new notification delivery capability.

### Patch Changes

- e9b915f: Each built-in integration (Trakt, TMDB, TVDB, Seerr, Plex, Jellyfin) is now its own package, so each one can be released and tracked on its own.
- b55a04b: Split capabilities into per-capability files with dedicated tests for each.
- Updated dependencies [db2b076]
- Updated dependencies [986fb74]
  - @ent-mcp/shared@0.1.1

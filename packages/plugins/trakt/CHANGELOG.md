# @ent-mcp/plugin-trakt

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
  - @ent-mcp/plugin-sdk@0.2.0

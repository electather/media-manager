---
"@ent-mcp/server": minor
---

Extend `idResolve@v1` to accept the server-local id types `plex:ratingKey` and `jellyfin:itemId` on both input `from` and output bundles so user-scoped media-server plugins (Plex, Jellyfin) can resolve their local ids to cross-service ids on a per-user basis.

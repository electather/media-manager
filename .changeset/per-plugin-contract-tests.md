---
"@ent-mcp/server": patch
---

Add per-plugin contract test files for TMDB, Trakt, TVDB, and Seerr so each built-in plugin has a dedicated test that drives every declared capability method against its Zod output schema — matching the Plex/Jellyfin pattern. Closes the "contract test per built-in plugin" checkbox on the plugin architecture v1 tracking issue.

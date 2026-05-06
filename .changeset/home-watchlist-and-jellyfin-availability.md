---
"@ent-mcp/server": patch
"@ent-mcp/plugin-jellyfin": patch
"@ent-mcp/plugin-trakt": patch
---

Fixed several home-feed availability issues: items not on a connected server no longer falsely report "available" when Jellyfin's TMDB filter is unsupported, your Trakt watchlist no longer disappears when an item has a missing IMDB id, and watchlist titles you have on Jellyfin now render even before the catalog has cached their metadata.

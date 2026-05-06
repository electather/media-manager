---
"@ent-mcp/plugin-sdk": minor
"@ent-mcp/plugin-jellyfin": minor
"@ent-mcp/plugin-plex": minor
"@ent-mcp/server": patch
---

Sped up the home feed: each library plugin now publishes a one-shot list of TMDB ids it has on hand, and the server uses that index for every availability check in a request instead of probing one title at a time.

---
"@ent-mcp/server": minor
---

Add `playbackSessions@v1` and `libraryAdmin@v1` capability contracts. `playbackSessions` exposes `getSessions` / `stopSession` with a `SessionEntry` that nests a `LibraryItem` plus transcoding decisions and state; `libraryAdmin` exposes fire-and-forget `refreshLibrary` / `refreshItem`. Both are `userScoped: true` and reuse the shared `LibraryItem` shape. No MCP tools yet — those land with the Plex and Jellyfin plugin implementations in #22 and #23.

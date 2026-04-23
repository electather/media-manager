---
"@ent-mcp/server": minor
"@ent-mcp/shared": minor
---

Add `libraryAvailability@v1` and `continueWatching@v1` capability contracts for self-hosted media-server plugins (Plex, Jellyfin). Introduce a shared `LibraryItem` zod schema (`@ent-mcp/shared/plugins/library`) reused by both capabilities and earmarked for the upcoming `playbackSessions@v1` / `libraryAdmin@v1` contracts.

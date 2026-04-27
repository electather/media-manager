---
"@ent-mcp/server": minor
"@ent-mcp/shared": patch
"@ent-mcp/client": minor
---

Added a batched artwork lookup so the home feed loads high-resolution posters and backdrops once cards are visible, with a graceful fallback to inline thumbnails while the lookup is in flight.

---
"@ent-mcp/server": patch
"@ent-mcp/client": patch
---

Fixed a crash on the home page when an old cached layout blob was served after the hero shape changed in the previous release; the home layout cache now invalidates those stale entries on first read.

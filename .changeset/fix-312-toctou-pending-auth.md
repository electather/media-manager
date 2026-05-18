---
"@ent-mcp/server": patch
---

Fixed a TOCTOU race in pending auth completion that could create duplicate connection rows under concurrent OAuth callbacks.

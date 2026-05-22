---
"@ent-mcp/server": patch
---

Fixed a race in the primary-connection preference write that could surface a 500 when two requests for the same capability arrived concurrently.

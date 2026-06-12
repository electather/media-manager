---
"@ent-mcp/server": patch
---

Fixed unsafe type cast in parseCombinedId, routing of media.no_connection errors to partial results instead of 500s, and increased layout_warm timeout with a per-source circuit breaker.

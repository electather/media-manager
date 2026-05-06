---
"@ent-mcp/server": patch
---

Requests to the bare `/api` path now return the same JSON error envelope as other unknown API routes instead of falling through to the SPA handler.

---
"@ent-mcp/client": patch
"@ent-mcp/server": patch
"@ent-mcp/shared": patch
---

Excluded the admin diagnostics namespace from HTTP perf capture so polling the Performance tab no longer skews its own samples, and made the perf aggregate endpoint honour the pinned request-id filter.

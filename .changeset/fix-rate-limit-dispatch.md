---
"@ent-mcp/server": patch
---

Fixed rate limiter bypass where unknown-tool and missing-scope requests could skip per-user quota enforcement.

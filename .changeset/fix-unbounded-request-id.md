---
"@ent-mcp/server": patch
---

Validated the incoming X-Request-Id header against a length and charset allowlist so malformed values no longer reach diagnostics tables.

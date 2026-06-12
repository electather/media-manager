---
"@ent-mcp/server": patch
---

Fixed SSRF blocklist bypass where trailing-dot hostnames (e.g. localhost.) could bypass exact-match blocklist checks.

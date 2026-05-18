---
"@ent-mcp/server": patch
---

Fixed a race condition in ensureDefaultIfFirst that could leave a plugin with no default connection under concurrent inserts.

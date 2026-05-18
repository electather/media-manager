---
"@ent-mcp/server": patch
---

Malformed JWT sub or scope claims are now rejected with a 401 instead of propagating as invalid values.

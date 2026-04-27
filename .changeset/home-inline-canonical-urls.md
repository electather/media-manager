---
"@ent-mcp/client": patch
---

Home rows reuse the artwork the server already provides instead of refetching it per card, so home loads with fewer network round-trips.

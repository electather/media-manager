---
"@ent-mcp/plugin-trakt": patch
---

Trakt syncing is more resilient: temporary Trakt outages no longer force you to re-authenticate, and malformed entries in your watchlist or ratings are skipped instead of crashing the request.

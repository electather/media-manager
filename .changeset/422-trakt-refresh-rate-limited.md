---
"@ent-mcp/plugin-trakt": patch
---

Fixed Trakt token refresh treating rate-limit responses as expired credentials; the connection no longer flips to "reconnect required" when Trakt returns 429.

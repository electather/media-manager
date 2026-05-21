---
"@ent-mcp/plugin-trakt": patch
"@ent-mcp/server": patch
---

Fixed Trakt token refresh treating rate-limit responses as expired credentials; the connection no longer flips to "reconnect required" when Trakt returns 429, and the per-connection job runner now honours the rate-limit cooldown before retrying.

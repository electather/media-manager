---
"@ent-mcp/server": patch
---

Fixed background token refreshes (e.g. Trakt) marking the connection as a generic "error" instead of "expired" — the connections view now shows the "Reconnect" prompt when the upstream revokes a refresh token.

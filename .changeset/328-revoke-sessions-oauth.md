---
"@ent-mcp/server": patch
---

Fixed admin revoke-sessions to also invalidate OAuth access tokens, refresh tokens, and consent grants, not just web sessions.

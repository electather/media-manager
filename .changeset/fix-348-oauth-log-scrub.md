---
"@ent-mcp/server": patch
---

Fixed sensitive OAuth fields (`access_token`, `refresh_token`, `client_secret`, `code`, `code_verifier`) being exposed in debug logs.

---
"@nama/server": patch
---

Rate-limited OAuth dynamic client registration to 5 attempts per hour per IP to protect against abuse while keeping unauthenticated MCP client discovery working.

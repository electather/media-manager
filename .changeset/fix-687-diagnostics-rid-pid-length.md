---
"@nama/client": patch
---

Capped `rid` to 64 characters and `pid` to 128 characters in the admin diagnostics search params to reject oversized values before they reach the server.

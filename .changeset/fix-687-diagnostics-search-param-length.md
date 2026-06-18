---
"@nama/server": patch
---

Bounded the admin diagnostics request-id filter so oversized or malformed values are rejected at the API boundary instead of reaching the database.

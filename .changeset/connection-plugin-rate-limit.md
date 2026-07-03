---
"@nama/server": patch
---

Added per-user rate limiting to connection verify, test, and OAuth endpoints to prevent cross-user exhaustion of the shared plugin fetch quota.

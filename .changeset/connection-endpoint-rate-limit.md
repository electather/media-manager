---
"@nama/server": patch
---

Added per-user rate limiting to connection verify, test, and OAuth device poll endpoints to prevent cross-user exhaustion of the shared per-plugin fetch quota.

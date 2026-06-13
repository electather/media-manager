---
"@nama/server": patch
---

Fixed unbounded data-export requests letting a single user exhaust memory by adding a per-user 5/hour rate limit to `/me/export` (429 + `Retry-After`).

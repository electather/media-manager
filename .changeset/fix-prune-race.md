---
"@nama/server": patch
---

Fixed a race condition in job history pruning by using a single atomic statement.

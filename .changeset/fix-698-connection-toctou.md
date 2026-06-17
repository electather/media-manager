---
"@nama/server": patch
---

Fixed connection mutation handlers to surface a not-found error instead of silently succeeding when the connection is deleted between the pre-check and the update.

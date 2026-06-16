---
"@nama/server": patch
---

Fixed the admin notification settings endpoint to return 400 when the request body contains no fields instead of silently succeeding with no change.

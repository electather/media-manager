---
"@nama/server": patch
---

Fixed unauthenticated access to /api/settings by adding requireSession middleware to the settings router.

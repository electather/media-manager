---
"@nama/server": patch
---

`PATCH /api/admin/notifications/settings` now returns 400 when the request body contains no retention fields instead of silently returning 200 with unchanged values.

---
"@nama/server": patch
---

Fixed the connection test handler to return not-found instead of silently writing to a deleted connection when the row is removed between the pre-check and the status update.

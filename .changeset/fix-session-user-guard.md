---
"@nama/server": patch
---

Fixed a 500 error when a session was returned without a user; the server now responds with 401 in this case.

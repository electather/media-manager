---
"@nama/server": patch
---

Fixed setting a connection as default so that, when the target connection is deleted at the same time, it reports a not-found error and leaves the previous default intact instead of clearing it.

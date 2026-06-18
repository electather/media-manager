---
"@nama/client": patch
---

Added charset validation to the `pid` search param in the admin diagnostics route to reject values containing characters outside the alphanumeric, hyphen, and underscore set.

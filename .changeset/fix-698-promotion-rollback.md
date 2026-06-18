---
"@nama/server": patch
---

Fixed connection default handling so that, when a connection is deleted or set as default at the same time as a concurrent change, the previous default is preserved and the operation reports a not-found error instead of leaving the plugin with no default connection.

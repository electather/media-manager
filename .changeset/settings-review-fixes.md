---
"@ent-mcp/client": patch
---

Fixed several issues in the settings wiring: failed connection tests now surface as errors instead of success toasts, bulk-revoke of authorized apps no longer leaves the cache in an inconsistent state on partial failure, the edit channel dialog no longer leaks state between channels, and profile saves no longer refetch the entire query tree.

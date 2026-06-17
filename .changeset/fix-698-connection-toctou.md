---
"@nama/server": patch
---

Fixed connection mutation handlers to throw an error when no matching row is found, eliminating a silent no-op on concurrent deletes.

---
"@nama/server": patch
---

Fixed a race condition where sourcemaps for a concurrently uploaded build could be deleted during retention sweeps.

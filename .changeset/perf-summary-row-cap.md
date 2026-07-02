---
"@nama/server": patch
---

Fixed unbounded memory load in the admin performance summary endpoint by capping rows to the existing aggregate budget.

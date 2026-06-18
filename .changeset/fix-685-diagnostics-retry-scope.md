---
"@nama/client": patch
---

Scoped the diagnostics error boundary retry to the failing surface's queries only, preventing unrelated tabs from re-suspending on retry.

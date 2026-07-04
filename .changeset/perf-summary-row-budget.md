---
"@nama/server": patch
---

Capped the number of HTTP perf rows loaded by the `/admin/diagnostics/perf/summary` endpoint to prevent unbounded memory use over a 24-hour window.

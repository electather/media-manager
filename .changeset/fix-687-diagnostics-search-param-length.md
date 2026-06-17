---
"@nama/client": patch
---

Capped the `rid` and `pid` admin diagnostics search parameters to 128 characters to avoid sending oversized values to the server.

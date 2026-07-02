---
"@nama/server": patch
---

Fixed per-row job timeouts so a timed-out row handler is cancelled instead of continuing to run alongside later rows.

---
"@nama/server": patch
---

Fixed per-row job handlers receiving an AbortSignal that fires on timeout so they can stop processing promptly.

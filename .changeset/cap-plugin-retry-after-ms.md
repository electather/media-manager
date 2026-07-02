---
"@nama/server": patch
---

Capped plugin-supplied retryAfterMs to 24 hours so a buggy or malicious plugin cannot push delivery retries arbitrarily far into the future.

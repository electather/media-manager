---
"@nama/server": patch
---

Mapped `AllPluginsFailedError` to a 503 `media.providers_failed` response carrying per-provider `errors[]` so clients can render per-provider hints instead of a generic 500.

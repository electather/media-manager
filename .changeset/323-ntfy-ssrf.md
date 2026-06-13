---
"@nama/plugin-ntfy": patch
---

Fixed SSRF vulnerability: ntfy plugin now validates serverUrl against the blocked-hostname list instead of allowing arbitrary hosts.

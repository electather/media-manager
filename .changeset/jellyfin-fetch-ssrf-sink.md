---
"@nama/server": patch
"@nama/plugin-jellyfin": patch
---

Closed a plugin SSRF hole where an allowlisted server URL that resolved to a loopback, link-local, or cloud metadata address could reach internal services, and stopped upstream error bodies from leaking back to callers.

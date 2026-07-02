---
"@nama/server": patch
---

Closed a DNS-rebinding hole by re-checking a plugin fetch target's resolved IP against the loopback and cloud-metadata blocklist at request time.

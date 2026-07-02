---
"@nama/server": patch
---

Fixed a race where the metadata prune could evict catalog entries that were accessed while the sweep was running.

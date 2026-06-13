---
"@nama/client": patch
---

Added removeOnEmpty option to rollbackQuery so stale optimistic writes are cleaned up when the cache was empty before the mutation.

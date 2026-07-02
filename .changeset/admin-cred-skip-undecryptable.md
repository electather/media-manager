---
"@nama/server": patch
---

Fixed admin credential pool aborting when a single row has a corrupt or missing ciphertext; undecryptable rows are now skipped individually so the remaining valid credentials are still returned.

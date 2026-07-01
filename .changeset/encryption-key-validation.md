---
"@nama/server": patch
---

Server now rejects a malformed or short ENCRYPTION_KEY at startup instead of silently using a weak all-zero AES key.

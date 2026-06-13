---
"@nama/server": patch
---

Fixed x-secret userConfig fields being stored plaintext for no-auth plugins by moving them into the encrypted credentials blob at connection creation.

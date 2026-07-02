---
"@nama/server": patch
---

Fixed encrypt() throwing RangeError on large plaintext by replacing argument-spread into String.fromCharCode with an Array.from-based approach.

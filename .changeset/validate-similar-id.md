---
"@nama/server": patch
---

Fixed path traversal vulnerability where a non-numeric id in a "type:id" similarity query could reach plugin URL paths unvalidated.

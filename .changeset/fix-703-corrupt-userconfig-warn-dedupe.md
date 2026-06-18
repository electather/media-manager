---
"@nama/server": patch
---

Deduplicated corrupt userConfig warnings so each distinct row logs at most once per process lifetime instead of at request rate.

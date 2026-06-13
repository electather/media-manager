---
"@nama/plugin-seerr": patch
---

Fixed `requestStatusSync` timing out against slow Seerr instances by widening its per-row budget to 120s.

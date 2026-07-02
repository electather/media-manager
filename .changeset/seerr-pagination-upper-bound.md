---
"@nama/plugin-seerr": patch
---

Added a maximum-page guard to the Seerr request sync to prevent an unbounded loop when the remote API misbehaves.

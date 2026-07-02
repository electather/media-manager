---
"@nama/plugin-seerr": patch
---

Fixed an unbounded pagination loop in the Seerr plugin that could run indefinitely if the remote API never returned a short page.

---
"@ent-mcp/server": patch
---

Fixed sparse bucket+sort combos returning fewer than `limit` items per page when matching rows fell outside the initial overshoot window.

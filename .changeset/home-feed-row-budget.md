---
"@ent-mcp/server": patch
---

Fixed the home feed shrinking to a single row when one of its providers was slow or rate-limited. Slow rows now stay in the layout with a partial-content marker instead of disappearing.

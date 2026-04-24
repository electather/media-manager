---
"@ent-mcp/client": patch
---

Fix the add/edit-connection modal going off-screen when a plugin's config form is taller than the viewport. `DialogContent` is now capped at `calc(100dvh - 2rem)` and its body is a vertically scrollable region, with the header and footer pinned. Scoped to the connection modal only — other dialogs are unchanged.

---
"@ent-mcp/server": patch
---

Fixed adding a notification channel for plugins that declare `auth.kind: "none"` (Telegram, Discord, ntfy). Previously the server tried to call the plugin's `startAuth` regardless of auth kind, surfacing "plugin telegram does not export startAuth" to the user.

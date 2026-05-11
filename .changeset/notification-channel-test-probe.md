---
"@ent-mcp/server": patch
---

Fixed the notification channel test endpoint, which previously reported "plugin has no testConnection" with `ok: true` for every notification plugin (Telegram, Discord, ntfy, inbox) because those plugins declare `auth.kind: "none"` and expose their probe via `notificationDelivery.testDelivery` rather than a module-level `testConnection`. The runtime now falls back to the capability's probe so the test surfaces real upstream failures.

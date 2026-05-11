---
"@ent-mcp/server": patch
---

Notification deliveries now fail loudly with a precise error code when a channel's stored configuration cannot be parsed, instead of handing a raw string to the plugin and surfacing the failure as a cryptic upstream error.

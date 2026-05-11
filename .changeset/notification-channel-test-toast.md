---
"@ent-mcp/client": patch
---

Fixed the notification channel "Test" toast, which previously always reported success because the endpoint returns HTTP 200 even when the probe fails. The client now reads the response body and surfaces the plugin's diagnostic (e.g. "telegram bot token rejected") as an error toast.

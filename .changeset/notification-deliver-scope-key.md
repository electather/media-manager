---
"@ent-mcp/server": patch
---

Fixed notification delivery to fan out concurrently across recipients. The `notification.deliver` job had no scope key, so emitting an event with multiple subscribed channels (e.g. inbox + Telegram) serialized at the job-runner lock — the first delivery ran and the rest immediately failed with "job notification.deliver is already running". The job now scopes its lock by `deliveryId`, so each channel's delivery runs in parallel and independently.

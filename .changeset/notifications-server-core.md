---
"@ent-mcp/server": minor
"@ent-mcp/plugin-inbox": minor
---

Added the notification delivery system with built-in in-app inbox. Notifications are currently disabled (NOTIFICATIONS_ENABLED=false) and will be enabled in a future PR.

- Single `emit()` dispatch seam for all emitters (jobs, plugins, server modules)
- Recipient resolution with role-based permission gating
- Delivery job with exponential backoff retry (5 attempts)
- Stale-pending sweep job (every 5 min) recovers deliveries stuck mid-retry
- 6 event templates (job.run.failed, connection.auth.expired, connection.sync.succeeded, media.request.available, media.request.denied, system.error)
- Built-in in-app inbox plugin with host-privileged access
- Backfill: auto-create inbox connection for all existing users with all-enabled subscriptions

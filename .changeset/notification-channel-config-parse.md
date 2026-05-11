---
"@ent-mcp/server": patch
---

Fixed notification delivery for third-party channel plugins (Telegram, Discord, ntfy, custom). The delivery job was forwarding the raw `service_connections.user_config` JSON text to each plugin's `deliver` and `testConnection` instead of the parsed object, so plugins reading e.g. `args.channelConfig.botToken` saw `undefined` and the call silently failed against the upstream. The job now parses `user_config` once at the boundary and threads the object through. Added tagged `consola` logs at every state transition (start, succeeded, rescheduled, failed, missing capability) so delivery failures are visible without inspecting the database.

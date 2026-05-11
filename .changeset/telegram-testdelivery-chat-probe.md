---
"@ent-mcp/plugin-telegram": patch
---

Fixed the Telegram channel test, which previously reported success whenever the bot token was valid even if the chat id was wrong or the bot was not a member of the chat. The test now also probes `getChat` and surfaces Telegram's own description (e.g. "chat not found", "bot was kicked") when the chat is unreachable.

---
"@ent-mcp/plugin-telegram": patch
---

Made the Telegram "Test" actually send a short labelled message to the target chat after the getMe/getChat probes pass — a passing probe alone cannot prove the bot has write permission, so a real send is the only end-to-end signal. Added structured logs on `deliver` and `testDelivery` (start, success, failure with telegram's description) so misconfigurations are easy to pinpoint in the server output. Chat ids are redacted to the last 4 chars in logs.

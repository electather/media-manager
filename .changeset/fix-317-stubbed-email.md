---
"@ent-mcp/server": patch
---

Surfaced misconfigured email setups immediately. When the email-enabled flag was on but no email provider was wired, verification and password-reset emails silently dropped; the server now fails loudly so operators can fix the deployment before users hit the broken flow.

---
"@ent-mcp/server": patch
---

Fixed account-deletion password verification to fail-closed on unknown Better Auth response shapes while still accepting the actual `{ status: true }` success contract.

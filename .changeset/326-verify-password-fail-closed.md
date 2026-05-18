---
"@ent-mcp/server": patch
---

Fixed password verification to fail-closed: unknown response shapes from Better Auth are now treated as verification failures instead of successes.

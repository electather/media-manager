---
"@ent-mcp/server": patch
---

Fixed SSRF via redirect: plugin fetches now reject 3xx responses instead of following them to unvalidated hosts.

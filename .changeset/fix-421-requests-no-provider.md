---
"@ent-mcp/server": patch
---

Fixed `GET /api/requests` returning 500 when no mediaRequest provider is configured; it now returns an empty list, and `DELETE /api/requests/:id` surfaces 404 `request.no_provider` in the same scenario.

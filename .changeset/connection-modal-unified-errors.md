---
"@ent-mcp/client": patch
---

Merge the add-connection modal's two separate error surfaces into one. Previously the "Test connection" button rendered its failure inline below the form while "Save" showed a generic `Failed to create connection.` in a different banner — both from the same underlying server error. Now both paths route through a single `topError` banner populated by the actual server message, and the client's error-body parser reads `params.message` / `devMessage` from the `UserFacingError` wire format so the user sees the real cause (e.g. the upstream plugin message) instead of a stock string.

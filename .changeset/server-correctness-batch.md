---
"@ent-mcp/server": patch
---

Fixed invalid combined media ids (including empty ids) being passed downstream instead of rejected, routed no-provider errors to an empty state instead of a server error, and made the home layout warm job stop retrying a slow or offline provider once it has failed repeatedly in a run.

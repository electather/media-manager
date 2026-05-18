---
"@ent-mcp/plugin-discord": patch
---

Capped retry-after delay to 1 hour to prevent arbitrarily long delivery backlogs from a crafted or misbehaving upstream response.

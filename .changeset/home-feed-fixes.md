---
"@ent-mcp/server": patch
---

Fixed home feed issues: hero items and detail summaries now include availability and status fields so request-vs-play CTAs render correctly, and unified the home-feed error responses so wrong-method/unknown-route requests return JSON error envelopes instead of plain-text 404s.

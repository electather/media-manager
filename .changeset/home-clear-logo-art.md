---
"@ent-mcp/client": patch
---

Cards, hero, detail modal, and detail hero now render the wire `clearLogo` image when available, falling back to the existing wordmark text. The detail page hero no longer falls back to the poster when a backdrop is missing — it stays empty so the cinematic backdrop never degrades to a stretched portrait.

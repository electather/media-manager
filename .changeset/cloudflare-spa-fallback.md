---
"@ent-mcp/server": patch
---

Fix Cloudflare Workers SPA routing so client-side routes (e.g. `/auth/login`) work on direct navigation and page refresh. Adds `not_found_handling = "single-page-application"` to the `[assets]` block in `wrangler.toml`, which makes Cloudflare Assets serve `index.html` with a 200 OK for any path that doesn't match a built asset.

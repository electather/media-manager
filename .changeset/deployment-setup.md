---
"@ent-mcp/server": minor
---

Add Cloudflare Workers entry point and deployment support:

- New `packages/server/src/worker.ts` Workers-compatible composition (excludes `serveStatic`, the croner scheduler, and the startup migration runner).
- `db/client.ts` now recognises hosted libSQL (Turso) URLs, skips `mkdirSync` for non-local URLs, and forwards `LIBSQL_AUTH_TOKEN` to `createClient`.
- `env.ts` accepts the new optional `LIBSQL_AUTH_TOKEN` variable.
- `index.ts` (self-hosted / Docker entry) now runs pending migrations at startup before the HTTP server accepts traffic.

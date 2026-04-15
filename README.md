# ent-mcp

An MCP server for entertainment management with a companion dashboard.

## Architecture

- **MCP server** (Streamable HTTP) — 6 tools for entertainment management
- **Dashboard API** (oRPC over Hono) — consumed by a static React SPA
- **Better Auth** — dashboard login and MCP client OAuth

## Getting Started

```bash
bun install
cp .env.example .env
# edit .env with your credentials

# run server
bun run dev:server

# run client (separate terminal)
bun run dev:client
```

## Packages

- `packages/server` — Hono + MCP + oRPC + Better Auth backend
- `packages/client` — React + TanStack Router + oRPC client SPA

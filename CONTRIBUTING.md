# Contributing

Thanks for your interest in contributing to ent-mcp. This project is a personal entertainment management platform — an MCP server with a companion React dashboard. It is in active development and breaking changes are expected.

## Before You Start

- Check existing [issues](../../issues) and [pull requests](../../pulls) to avoid duplicate work.
- For significant changes, open an issue first to discuss the approach.
- This project follows [Conventional Commits](https://www.conventionalcommits.org/) and uses [Changesets](https://github.com/changesets/changesets) for versioning.

## Development Setup

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3 and [Vite+](https://vite.plus) (`vp` CLI).

```bash
# Clone and install
git clone https://github.com/electather/media-manager.git
cd media-manager
bun install

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
bun run db:migrate

# Start the development server and client
bun run dev
```

The server runs on port `3000` and the client on port `5173` by default.

## Project Structure

```
apps/
  client/         # React SPA (TanStack Router, React Query)
  server/         # Hono + MCP + Better Auth backend
packages/
  shared/         # Isomorphic types, schemas, enums (zod only)
  plugin-sdk/     # Plugin authoring SDK
  plugins/        # Built-in plugins (trakt, tmdb, plex, jellyfin, …)
```

## Workflow

```bash
vp check    # Format, lint, and type-check
vp test     # Run the test suite
```

Always run both before submitting a pull request.

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Make focused, incremental changes — one logical change per PR.
3. Add tests for new behaviour.
4. Add a changeset file in `.changeset/` describing the change in end-user language (see [CLAUDE.md](CLAUDE.md) for format rules).
5. Ensure `vp check` and `vp test` pass.
6. Open a PR using the provided template.

## Writing Plugins

Plugins implement capabilities from `@ent-mcp/plugin-sdk`. See the [Plugin Architecture Design](docs/2026-04-19-plugin-architecture-design.md) for a full walkthrough and the existing plugins under `packages/plugins/` as reference implementations.

Key rules:

- Plugins depend only on `@ent-mcp/plugin-sdk`. No cross-plugin imports.
- Use `ctx.fetch` for all network requests — it is gated by the manifest allowlist.
- Credentials are never logged or stored in plaintext.

## Code Style

- TypeScript strict mode throughout.
- Utility functions use `es-toolkit` — do not reimplement `compact`, `merge`, `cloneDeep`, `sortBy`, etc.
- Client features live under `apps/client/src/features/<name>/`. Cross-feature imports are not allowed.
- Comments only when the _why_ is non-obvious. No descriptive comments that restate what the code does.

## Reporting Issues

Open a [GitHub issue](../../issues/new/choose). Include steps to reproduce, expected behaviour, actual behaviour, and your environment (OS, Bun version, deploy target).

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).

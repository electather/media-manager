<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

Project use Vite+, unified toolchain on Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, Vite Task. Vite+ wrap runtime mgmt, package mgmt, frontend tooling in single global CLI `vp`. Vite+ distinct from Vite, but invoke Vite via `vp dev` and `vp build`.

## Vite+ Workflow

`vp` global binary, handle full dev lifecycle. `vp help` list commands, `vp <command> --help` for specific command info.

### Start

- create - New project from template
- migrate - Migrate existing project to Vite+
- config - Configure hooks + agent integration
- staged - Run linters on staged files
- install (`i`) - Install deps
- env - Manage Node.js versions

### Develop

- dev - Run dev server
- check - Run format, lint, TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute command from local `node_modules/.bin`
- dlx - Execute package binary, no install as dep
- cache - Manage task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ auto-detect + wrap underlying package manager (pnpm, npm, Yarn) via `packageManager` field in `package.json` or pm-specific lockfiles.

- add - Add packages to deps
- remove (`rm`, `un`, `uninstall`) - Remove packages from deps
- update (`up`) - Update packages to latest
- dedupe - Deduplicate deps
- outdated - Check outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why package installed
- info (`view`, `show`) - View package info from registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward command to package manager

### Maintain

- upgrade - Update `vp` itself to latest

Commands map to corresponding tools. E.g. `vp dev --port 3000` run Vite dev server, same as Vite. `vp test` run JS tests via bundled Vitest. Check version of all tools via `vp --version`. Useful for docs, features, bugs research.

## Common Pitfalls

- **Using package manager directly:** No pnpm/npm/Yarn direct. Vite+ handle all pm ops.
- **Always use Vite commands to run tools:** No `vp vitest` or `vp oxlint`. Don't exist. Use `vp test` and `vp lint`.
- **Running scripts:** Built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run Vite+ built-in tool, not `package.json` script of same name. Custom script sharing built-in name → use `vp run <script>`. E.g. custom `dev` script running multiple services concurrent → run via `vp run dev`, not `vp dev` (always start Vite dev server).
- **No direct install of Vitest, Oxlint, Oxfmt, tsdown:** Vite+ wrap these. Must not install direct. Cannot upgrade by installing latest. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` not pm-specific `dlx`/`npx`.
- **Import JS modules from `vite-plus`:** Instead of `vite` or `vitest`, import all modules from project `vite-plus` dep. E.g. `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. Must not install `vitest` for test utilities.
- **Type-Aware Linting:** No need install `oxlint-tsgolint`, `vp lint --type-aware` work out of box.

## CI Integration

GitHub Actions: use [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, pm setup, cache, install steps with single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pull remote changes, before start.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->

## Pull Requests and Versioning

Project use [Changesets](https://github.com/changesets/changesets). Every PR need `.changeset/<slug>.md` file or CI fail. Create file direct — no CLI run.

Released packages (`private: false`): `@ent-mcp/client`, `@ent-mcp/server`, `@ent-mcp/plugin-sdk`, every `@ent-mcp/plugin-<id>` (trakt, tmdb, tvdb, seerr, plex, jellyfin). Never list `@ent-mcp/shared` — internal-only.

```md
---
"@ent-mcp/client": minor
---

Added a connections page for reviewing and revoking linked apps.
```

- Bump: `patch` (fix), `minor` (new feature), `major` (breaking).
- Description: one short sentence, end-user language, past tense ([Keep a Changelog](https://keepachangelog.com) style). No file names, PR numbers, impl detail.
- One logical change per file.
- Internal-only changes (refactors, tests, docs, CI, deps): empty frontmatter, no body:

  ```md
  ---
  ---
  ```

## Shared Package (`@ent-mcp/shared`)

Anything used by both client + server live in `packages/shared/` — domain enum tuples, public types, zod schemas. Workspaces: `apps/{client,server}`, `packages/{shared,plugin-sdk}`, `packages/plugins/*`. Consumers depend direct as `"@ent-mcp/shared": "workspace:*"` in own `package.json`; no `catalog:` indirection for this package.

### Rules

- **Import direct from shared package.** Use `@ent-mcp/shared/jobs`, `@ent-mcp/shared/plugins`, etc. — never re-export shared symbols via local shim file. If server/client module only re-export, delete + point callers at shared.
- **Shared hold what cross boundary.** Drizzle tables, drizzle-zod schemas, server-internal interfaces (`PluginContext`, `ErrorSink`, `JobRunContext`, etc.) stay on server. UI-local types stay on client.
- **Enums are `as const` tuples.** Export values like `export const JOB_RUN_STATUSES = [...] as const;` plus derived type. Drizzle consume tuple via `text("x", { enum: CONST })`, Zod via `z.enum(CONST)` — one source, both sides.
- **Adding new domain**: create `packages/shared/src/<domain>/{enums,types,schemas,index}.ts` and wire subpath export in `packages/shared/package.json`.
- **Shared has no runtime deps besides zod** (catalog). No `drizzle-orm`, `hono`, framework deps — keep isomorphic.

## Token Savior MCP

`token-savior` MCP server registered. Prefer structural code-nav tools over `Read` + `Grep` when exploring symbols, sources, deps in this repo. Use memory engine (`memory_*`) for session-spanning context — override file-based auto-memory at `~/.claude/projects/.../memory/` for this project.

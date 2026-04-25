<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->

## Pull Requests and Versioning

This project uses [Changesets](https://github.com/changesets/changesets). Every PR needs a `.changeset/<slug>.md` file or CI fails. Create the file directly — don't run the CLI.

Released packages (`private: false`): `@ent-mcp/client`, `@ent-mcp/server`, `@ent-mcp/plugin-sdk`, and every `@ent-mcp/plugin-<id>` (trakt, tmdb, tvdb, seerr, plex, jellyfin). Never list `@ent-mcp/shared` — it is internal-only.

```md
---
"@ent-mcp/client": minor
---

Added a connections page for reviewing and revoking linked apps.
```

- Bump: `patch` (fix), `minor` (new feature), `major` (breaking).
- Description: one short sentence, end-user language, past tense ([Keep a Changelog](https://keepachangelog.com) style). No file names, no PR numbers, no implementation detail.
- One logical change per file.
- For internal-only changes (refactors, tests, docs, CI, deps), use empty frontmatter and no body:

  ```md
  ---
  ---
  ```

## Shared Package (`@ent-mcp/shared`)

Anything used by both client and server lives in `packages/shared/` — domain enum tuples, public types, and zod schemas. Workspaces: `apps/{client,server}`, `packages/{shared,plugin-sdk}`, `packages/plugins/*`. Consumers depend on it directly as `"@ent-mcp/shared": "workspace:*"` in their own `package.json`; there is no `catalog:` indirection for this package.

### Rules

- **Import directly from the shared package.** Use `@ent-mcp/shared/jobs`, `@ent-mcp/shared/plugins`, etc. — never re-export shared symbols through a local shim file. If a server/client module only needs to re-export, delete it and point callers at shared.
- **Shared holds what crosses the boundary.** Drizzle tables, drizzle-zod schemas, and server-internal interfaces (`PluginContext`, `ErrorSink`, `JobRunContext`, etc.) stay on the server. UI-local types stay on the client.
- **Enums are `as const` tuples.** Export values like `export const JOB_RUN_STATUSES = [...] as const;` plus a derived type. Drizzle consumes the tuple via `text("x", { enum: CONST })` and Zod via `z.enum(CONST)` — one source, both sides.
- **When adding a new domain**, create `packages/shared/src/<domain>/{enums,types,schemas,index}.ts` and wire a subpath export in `packages/shared/package.json`.
- **Shared has no runtime deps besides zod** (catalog). Don't add `drizzle-orm`, `hono`, or framework deps — keep it isomorphic.

## Token Savior MCP

The `token-savior` MCP server is registered. Prefer its structural code-navigation tools over `Read` + `Grep` when exploring symbols, sources, or dependencies in this repo. Use its memory engine (`memory_*`) for session-spanning context — overrides the file-based auto-memory at `~/.claude/projects/.../memory/` for this project.

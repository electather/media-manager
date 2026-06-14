<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Frontend Skills

∀ React change @ `apps/client/` → skill ! before edit:

- `vercel-react-best-practices` — new|edit component, hook, data fetch
- `vercel-composition-patterns` — ≥3 bool props | reusable API
- `vercel-react-view-transitions` — route|page|list anim

Skip @ server, shared, plugin pkgs.

## Pull Requests and Versioning

Project use [Changesets](https://github.com/changesets/changesets). Every PR need `.changeset/<slug>.md` file or CI fail. Create file direct — no CLI run.

Released packages (`private: false`): `@nama/client`, `@nama/server`, `@nama/plugin-sdk`, every `@nama/plugin-<id>` (trakt, tmdb, tvdb, seerr, plex, jellyfin). Never list `@nama/shared` — internal-only.

```md
---
"@nama/client": minor
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

## Shared Package (`@nama/shared`)

Anything used by both client + server live in `packages/shared/` — domain enum tuples, public types, zod schemas. Workspaces: `apps/{client,server}`, `packages/{shared,plugin-sdk}`, `packages/plugins/*`. Consumers depend direct as `"@nama/shared": "workspace:*"` in own `package.json`; no `catalog:` indirection for this package.

### Rules

- **Import direct from shared package.** Use `@nama/shared/jobs`, `@nama/shared/plugins`, etc. — never re-export shared symbols via local shim file. If server/client module only re-export, delete + point callers at shared.
- **Shared hold what cross boundary.** Drizzle tables, drizzle-zod schemas, server-internal interfaces (`PluginContext`, `ErrorSink`, `JobRunContext`, etc.) stay on server. UI-local types stay on client.
- **Enums are `as const` tuples.** Export values like `export const JOB_RUN_STATUSES = [...] as const;` plus derived type. Drizzle consume tuple via `text("x", { enum: CONST })`, Zod via `z.enum(CONST)` — one source, both sides.
- **Adding new domain**: create `packages/shared/src/<domain>/{enums,types,schemas,index}.ts` and wire subpath export in `packages/shared/package.json`.
- **Shared has no runtime deps besides zod** (catalog). No `drizzle-orm`, `hono`, framework deps — keep isomorphic.

## Token Savior MCP

`token-savior` MCP server registered. Prefer structural code-nav tools over `Read` + `Grep` when exploring symbols, sources, deps in this repo. Use memory engine (`memory_*`) for session-spanning context — override file-based auto-memory at `~/.claude/projects/.../memory/` for this project.

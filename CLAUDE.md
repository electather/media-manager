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

- `frontend-feature-architecture` — new feature, retrofit feature folder, review feature PR
- `vercel-react-best-practices` — new|edit component, hook, data fetch
- `vercel-composition-patterns` — ≥3 bool props | reusable API
- `vercel-react-view-transitions` — route|page|list anim

Skip @ server, shared, plugin pkgs.

## Backend Skills

∀ server module change @ `apps/server/src/{artwork,auth,catalog,home,media,notifications,preferences,plugin-runtime}/` → skill ! before edit:

- `backend-feature-architecture` — new|retrofit module, add event, review module PR

Skip @ adapters (`api/`, `mcp/`) and infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`, `jobs/`).

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

## Rule 1 — Think Before Coding

State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First

Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes

Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.

## Rule 4 — Goal-Driven Execution

Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

## Rule 5 — Use the model only for judgment calls

Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory

Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them

If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Rule 8 — Read before you write

Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior

Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step

Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree

Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud

"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

## Rule 13 — docs/\* = source of truth

Read relevant design doc before any change. Update it after.
Design describes intended final state across phases — code listed as "kept" stays even if currently unused.
Check linked issue before deleting anything flagged by tooling.

## Rule 14 — Never increase fallow baseline

Flag → fix root cause. No new entries in `.fallow/dead-code-baseline.json`.
Exception: add `// fallow-ignore-file <rule>` or `// fallow-ignore-next-line <rule>` inline with one-line reason.

## Token Savior MCP

`token-savior` MCP server registered. Prefer structural code-nav tools over `Read` + `Grep` when exploring symbols, sources, deps in this repo. Use memory engine (`memory_*`) for session-spanning context — override file-based auto-memory at `~/.claude/projects/.../memory/` for this project.

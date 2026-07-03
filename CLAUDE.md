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

- **Import direct from shared package.** Use `@nama/shared/jobs`, `@nama/shared/plugins`, etc. — never re-export shared symbols via local shim file. If server/client module only re-export, delete + point callers at shared. No "coherent surface" exceptions: re-export is allowed _only_ when importing direct would break module encapsulation (e.g. exposing a module's private internals), not merely for stylistic grouping.
- **Shared hold what cross boundary.** Drizzle tables, drizzle-zod schemas, server-internal interfaces (`PluginContext`, `ErrorSink`, `JobRunContext`, etc.) stay on server. UI-local types stay on client.
- **Enums are `as const` tuples.** Export values like `export const JOB_RUN_STATUSES = [...] as const;` plus derived type. Drizzle consume tuple via `text("x", { enum: CONST })`, Zod via `z.enum(CONST)` — one source, both sides.
- **Adding new domain**: create `packages/shared/src/<domain>/{enums,types,schemas,index}.ts` and wire subpath export in `packages/shared/package.json`.
- **Shared has no runtime deps besides zod** (catalog). No `drizzle-orm`, `hono`, framework deps — keep isomorphic.

## Comment Conventions

Keep every comment to **3 lines or fewer**. A comment earns its space only by recording what a future reader could NOT reconstruct from the code itself. Exceed 3 lines only when a 4th/5th line is the only way to preserve something in the "include" list below — never pad, never truncate load-bearing detail to hit the count.

**Include (the reason comments exist):**

- Design choices and rejected alternatives, with the reason — "uses A instead of B because B breaks on Z". Stops the next dev from undoing it.
- Design-doc / spec references verbatim: section anchors (`design §B3`), invariant names (`V.CL1`), issue/PR numbers (`#505`).
- The meaning of magic numbers/literals not named in the code, and stepped progressions whose steps encode intent (`5s → 10s → 20s → cap 30s`, not `5s→30s`).
- Marker/constant/field names that bridge to a convention (`x-plugin-resolved: true`, `SYSTEM_ADMIN_ROLE_NAME`), and required call shapes (`new Hono().use("*", requireSession)`).
- Exact failure modes, security consequences, and threat models — never soften "immediate privilege escalation" into "a problem".
- Edge cases, gotchas, business/domain requirements, invariants, the non-obvious "why", known limitations.

**Skip (delete on sight):**

- Restating what the next line of code plainly does; narration; decorative banners.
- `@param`/`@returns` that just echo the signature and types.
- Anything obvious from names and types.

When unsure whether a detail is obvious, keep it. Preserve the original delimiter style (`/** */` vs `//`) when shortening.

## Principles

- Simplest change that works. No speculative code, no abstraction for single use.
- Surgical. Touch only what task needs. No drive-by refactor/reformat of adjacent code.
- Read exports + callers + shared utils before edit. Unsure why code structured so → ask, don't guess.
- Match codebase conventions even if disagree. Think one harmful → surface, don't fork silent.
- Ambiguity → state assumptions, offer interpretations, ask. Simpler path exists → push back.
- Conflicting patterns → pick more-tested, flag other for cleanup. No blend.
- Define success criteria, loop till verified.
- Tests encode WHY (must fail when business logic changes), not just WHAT.
- Fail loud. Skipped step/test → not "done". Surface uncertainty, don't hide.

## docs/\* = source of truth

Read relevant design doc before change, update after. Design = intended final state across phases — code marked "kept" stays even if currently unused. Check linked issue before deleting anything tooling flags.

## Never increase fallow baseline

Flag → fix root cause. No new entries in `.fallow/dead-code-baseline.json`.
Exception: add `// fallow-ignore-file <rule>` or `// fallow-ignore-next-line <rule>` (bare — no inline reason text; fallow parses extra tokens as rule names and warns on stale suppressions; put the reason in the commit message instead).

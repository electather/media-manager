---
name: backend-feature-architecture
description: Standard architecture for apps/server/src/<module>/ modules. Use when creating a new server module, retrofitting an existing one, or reviewing module-folder PRs. Covers flat-with-reserved-files layout, barrel-only public API, sync calls via service, async signals via typed emit/on wrapper on jobs/ infra, owned drizzle tables, and fallow-enforced boundaries (8 per-module zone pairs). Notifications is the canonical example after Phase 2 lands.
metadata:
  version: "1.0.0"
---

# Backend Feature Architecture

Standard architecture for `apps/server/src/<module>/` modules in the modular monolith. Defines **where code lives** and **how modules talk to each other**. Companion skills (`clean-code`, `fallow`, `es-toolkit`, `backprop`, `frontend-feature-architecture`) define how code reads — invoke them in addition to this skill.

Skip this skill for `apps/server/src/{api,mcp}` (adapters), `apps/server/src/{db,cache,crypto,connections,diagnostics,jobs}` (infra), `packages/shared`, `packages/plugin-sdk`, `packages/plugins/*`.

## Module map

The 8 modules (each: fallow zone + `-internal` sub-zone + barrel + skill rules):

`artwork`, `auth`, `catalog`, `home`, `media`, `notifications`, `preferences`, `plugin-runtime`.

NOT modules (free imports, no barrel): `db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`, `jobs/` (infra). `api/`, `mcp/` are inbound adapters.

`jobs/` is infra AND the event bus. Modules import `emit` / `on` from `jobs/events` like they import `db/` — no barrel rule.

## Canonical example

Live reference: [`apps/server/src/notifications/`](../../../apps/server/src/notifications/). After Phase 2 of the boundaries migration this matches the template exactly. Until then, this skill is the source of truth and `notifications/` is the in-flight target.

## Decision tree

```
working on a server module?
├─ new module
│   └─ flat layout — see references/module-layout.md
│       <module>/{index.ts, service.ts, events.ts?, errors.ts, types.ts,
│                  repo.ts, jobs/, internal/, __tests__/}
│
├─ existing module, adding a feature
│   └─ keep the layout. follow rules 1–12 below.
│
└─ existing module, retrofit
    └─ see references/examples/retrofit-existing.md
```

Files exist only when their role is needed. Promote single file → directory when caps hit (`service.ts` >500 LOC, `repo.ts` >300 LOC). No `helpers.ts`, `utils.ts`, `misc.ts`.

## Hard rules (cite by number in PRs and reviews)

1. **Barrel-only entry.** Other modules import via path that resolves to `<module>/index.ts`. Deep imports (resolving to `service.ts`, `repo.ts`, `internal/**`, `jobs/<x>.ts`) from outside the module are forbidden — fallow `server-mod-<x>-internal` blocks them.
2. **No raw drizzle outside `repo.ts`.** `service.ts` and `jobs/<x>.ts` call `repo.fn()`. Only `repo.ts` (or `repo/<file>.ts`) imports `drizzle-orm` and the schema.
3. **Own tables only in own `repo.ts`.** Each drizzle table has one owning module declared as `// @owner: <module>` in its schema file. Other modules read/write through the owner's barrel. `tools/check-table-ownership.ts` enforces.
4. **Sync via `service.ts`, async via `events.ts` + `jobs/`.** No cross-module fire-and-forget via direct function calls. No cross-module DB writes through shared schema imports.
5. **`events.ts` is the published async contract.** Adding/changing payload fields = changeset entry + semver bump for `@ent-mcp/server`.
6. **Tests live in `__tests__/` next to code.** Unit tests mock `repo.ts`. Integration tests mock other modules' barrels, not their internals.
7. **One handler per file in `jobs/`.** File name matches event handled (e.g. `on-catalog-media-added.ts`). Exports `register<X>(): void`. No top-level `on(...)` calls.
8. **`internal/` is private.** Never imported from outside the module. Enforced by `server-mod-<x>-internal` zone.
9. **No cyclic module deps.** A → B → A forbidden statically. Break with events. Fallow `circular-deps: error` for `server-mod-*`.
10. **Adapters (`api/`, `mcp/`) only call module barrels.** Modules never import adapters.
11. **No `utils.ts`, `helpers.ts`, `misc.ts`.** Junk-drawer names hide growth. Name files by responsibility.
12. **One source of truth for events.** `events.ts` exports `<MODULE>_EVENTS` `as const` + zod schemas; emitters reference the constant, never the literal.

## Sync vs async

> **Sync** when the caller needs the result to complete its work (e.g. `home` composes layout from `catalog`).
> **Async (event)** when the caller signals "this happened" and doesn't need an answer (e.g. media added → notify users, refresh search index).

Heuristic: *if removing the call would leave the caller's return value unchanged but produce a missing side-effect, it should be an event.*

## Companion skills

Backend-feature-architecture defines *where code lives* and *how modules talk*; skills below define *how code reads*.

| Skill | Trigger | Why |
|---|---|---|
| `clean-code` | New/edit module file | Small functions (≤50 LOC), naming, single responsibility, ≤3 params |
| `fallow` | Before commit on module change | Verify zone rules + health budgets (cyclomatic ≤15) |
| `es-toolkit` | Array/object/string ops in service or repo | Replace native/custom utils |
| `backprop` | Bug found in module | Decide if a new invariant prevents recurrence |
| `frontend-feature-architecture` | Full-stack PR with `apps/client/` changes too | Sibling skill; vertical-slice symmetry |

Skip frontend-only skills (`vercel-react-*`, `shadcn`, `web-design-guidelines`, `vercel-composition-patterns`, `vercel-react-view-transitions`, `paraglide-js`).

## References

- [`module-layout.md`](references/module-layout.md) — flat-with-reserved-files, reserved file roles, promotion rules, size caps.
- [`service-and-repo.md`](references/service-and-repo.md) — sync API via barrel-exported service, drizzle isolation, factory accessor pattern.
- [`events-and-jobs.md`](references/events-and-jobs.md) — typed `emit`/`on`, event naming, boot order, fan-out, runtime cycles.
- [`db-ownership.md`](references/db-ownership.md) — `@owner:` directive grammar, ownership script, multi-table-per-file split rule.
- [`fallow-zones.md`](references/fallow-zones.md) — first-match-wins ordering, two-zone trick, allow-list contract, severity, health budgets.
- [`checklist.md`](references/checklist.md) — new-module + retrofit + PR-review checklists.
- [`examples/new-module.md`](references/examples/new-module.md) — scaffold a fresh module end-to-end.
- [`examples/add-event.md`](references/examples/add-event.md) — declare and consume a cross-module event.
- [`examples/retrofit-existing.md`](references/examples/retrofit-existing.md) — convert a drifted module to the template.

## Workflow

1. Identify task: new module, retrofit, or feature inside an existing module.
2. Read [`module-layout.md`](references/module-layout.md) for file shape.
3. Read [`service-and-repo.md`](references/service-and-repo.md) for sync API contract.
4. Read [`events-and-jobs.md`](references/events-and-jobs.md) for async pattern.
5. Read [`db-ownership.md`](references/db-ownership.md) if introducing or moving a table.
6. If creating a new module, update `.fallowrc.json` zones (see [`fallow-zones.md`](references/fallow-zones.md)) and wire `<module>.registerJobs()` into `apps/server/src/{index,worker}.ts` in alphabetical order.
7. Run `vp check` and `vp test`.
8. Run `fallow dead-code --format json --quiet 2>/dev/null || true` before opening the PR.
9. Add a changeset entry per `CLAUDE.md` Pull Requests and Versioning section.

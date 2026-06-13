---
name: backend-feature-architecture
description: Standard architecture for apps/server/src/<module>/ modules. Use when creating a new server module, retrofitting an existing one, or reviewing module-folder PRs. Covers flat-with-reserved-files layout, barrel-only public API, sync calls via service, async signals via typed emit/on wrapper on jobs/ infra, owned drizzle tables, and fallow-enforced boundaries (8 per-module zone pairs). Notifications is the canonical example after Phase 2 lands.
metadata:
  version: "1.0.0"
---

# Backend Feature Architecture

Std arch for `apps/server/src/<module>/` in modular monolith. Defines *where code lives* + *how modules talk*. Companion skills define *how code reads* — invoke alongside.

Skip for: `{api,mcp}` (adapters), `{db,cache,crypto,connections,diagnostics,jobs}` (infra), `packages/shared`, `packages/plugin-sdk`, `packages/plugins/*`.

## Module map

8 modules (each: fallow zone + `-internal` sub-zone + barrel + rules):

`artwork` `auth` `catalog` `home` `media` `notifications` `preferences` `plugin-runtime`

NOT modules (free imports, no barrel): `db/ cache/ crypto/ connections/ diagnostics/ jobs/`

`api/` `mcp/` = inbound adapters only.

`jobs/` = infra AND event bus. Modules import `emit`/`on` from `jobs/events` like `db/` — no barrel rule.

## Canonical example

[`apps/server/src/notifications/`](../../../apps/server/src/notifications/) — post Phase 2 matches template exactly. Until then: skill = source of truth.

## Decision tree

```
task?
  new-module    → flat layout (refs/module-layout.md)
                  files: index, service, events?, errors, types, repo, jobs/, internal/, __tests__/
  add-feature   → keep layout, follow rules 1–12
  retrofit      → refs/examples/retrofit-existing.md

file exists only when role needed
promote single→dir when: service.ts >500 LOC | repo.ts >300 LOC
no helpers.ts | utils.ts | misc.ts
```

## Hard rules

1. **Barrel-only entry.** Outside → `<module>/index.ts` only. Deep imports → forbidden. `server-mod-<x>-internal` fallow zone blocks.
2. **No raw drizzle outside `repo.ts`.** `service`/`jobs` call `repo.fn()`. Only `repo.ts` imports `drizzle-orm` + schema.
3. **Own tables only.** Each module's tables live under `db/schema/<module>/`. Others → read/write via owner barrel. `server-schema-<module>` fallow zone blocks cross-module reads.
4. **Sync via `service.ts`, async via `events.ts`+`jobs/`.** No cross-mod fire-and-forget. No cross-mod DB writes via shared schema.
5. **`events.ts` = published async contract.** Payload change → changeset + semver bump `@nama/server`.
6. **Tests in `__tests__/`.** Unit → mock `repo.ts`. Integration → mock other modules' barrels, not internals.
7. **One handler per file in `jobs/`.** Filename = event handled (`on-catalog-media-added.ts`). Exports `register<X>(): void`. No top-level `on(...)`.
8. **`internal/` = private.** Never imported outside. `server-mod-<x>-internal` zone enforces.
9. **No cyclic deps.** A→B→A forbidden. Break w/ events. Fallow `circular-deps: error` on `server-mod-*`.
10. **Adapters only call barrels.** Modules never import adapters.
11. **No `utils/helpers/misc.ts`.** Name by responsibility.
12. **One event source of truth.** `events.ts` exports `<MODULE>_EVENTS as const` + zod schemas. Emitters ref constant, never literal.

## Sync vs async

```
caller needs result  →  sync  (service call)
caller signals "happened", no answer needed  →  async (event)

test: remove call → return val unchanged but side-effect missing? → event
```

## Companion skills

| Skill | Trigger | Rule |
|---|---|---|
| `clean-code` | New/edit module file | fn ≤50 LOC, naming, SRP, ≤3 params |
| `fallow` | Pre-commit on module | Verify zones + health (cyclomatic ≤15) |
| `es-toolkit` | Array/obj/str ops in service/repo | Replace native/custom utils |
| `backprop` | Bug found | New invariant to prevent recurrence? |
| `frontend-feature-architecture` | Full-stack PR | Sibling skill; vertical-slice symmetry |

Skip frontend-only skills.

## References

- [`module-layout.md`](references/module-layout.md) — flat layout, reserved file roles, promotion rules, size caps
- [`service-and-repo.md`](references/service-and-repo.md) — sync API, drizzle isolation, factory accessor
- [`events-and-jobs.md`](references/events-and-jobs.md) — typed emit/on, event naming, boot order, fan-out, runtime cycles
- [`db-ownership.md`](references/db-ownership.md) — per-module schema namespaces, fallow zone enforcement, cross-module crossing protocol
- [`fallow-zones.md`](references/fallow-zones.md) — first-match-wins, two-zone trick, allow-list, severity, health budgets
- [`checklist.md`](references/checklist.md) — new-module + retrofit + PR-review checklists
- [`examples/new-module.md`](references/examples/new-module.md) — scaffold fresh module end-to-end
- [`examples/add-event.md`](references/examples/add-event.md) — declare + consume cross-mod event
- [`examples/retrofit-existing.md`](references/examples/retrofit-existing.md) — convert drifted module to template

## Workflow

```
1. task = new-mod | retrofit | add-feature
2. read module-layout.md → file shape
3. read service-and-repo.md → sync API contract
4. read events-and-jobs.md → async pattern
5. table change? → read db-ownership.md
6. new-mod? → update .fallowrc.json zones + wire registerJobs() into {index,worker}.ts (alpha order)
7. vp check && vp test
8. fallow dead-code --format json --quiet || true
9. add changeset (CLAUDE.md versioning rules)
```

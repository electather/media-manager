# Checklists

## New module

- [ ] Pick a name. Confirm it's a real domain (not infra, not an adapter).
- [ ] Create folder `apps/server/src/<module>/` with canonical layout — see [`module-layout.md`](module-layout.md).
- [ ] `index.ts` (barrel) — re-exports service + events + errors + types + `registerJobs`.
- [ ] `service.ts` — class + `get<Module>Service()` factory. No `drizzle-orm` imports.
- [ ] `repo.ts` — drizzle queries on owned tables only. Sole place `drizzle-orm` is imported.
- [ ] `errors.ts` — one base error + specific subclasses.
- [ ] `types.ts` — public domain types. Pure.
- [ ] `events.ts` (if module emits events) — `<MODULE>_EVENTS as const` + zod schemas + types.
- [ ] `jobs/` — one handler file per event; `jobs/index.ts` aggregates via `registerJobs()`. No top-level `on(...)`.
- [ ] `internal/` — private helpers.
- [ ] `__tests__/` — unit tests mocking `repo.ts`.
- [ ] Add 2 zones to `.fallowrc.json` (narrower listed first) + 2 rules — see [`fallow-zones.md`](fallow-zones.md).
- [ ] Update other modules' rules / adapter rules to include `server-mod-<new>` where needed.
- [ ] Annotate any new drizzle schema files with `// @owner: <module>` — see [`db-ownership.md`](db-ownership.md).
- [ ] Wire `<module>.registerJobs()` into `apps/server/src/{index,worker}.ts` in alphabetical position.
- [ ] Companion skills invoked: `clean-code`, `fallow`, `es-toolkit`, `backprop`. `frontend-feature-architecture` if there's a paired client feature.
- [ ] Changeset added (per `CLAUDE.md` Pull Requests and Versioning).
- [ ] `vp check` + `vp test` clean. `fallow dead-code` shows `boundary_violations: []`.
- [ ] `tools/check-table-ownership.ts` and `tools/check-file-sizes.ts` green.

## Retrofit

- [ ] Inventory: list current files, map each to a reserved role.
- [ ] Extract `repo.ts` from existing data-access code. `service.ts` calls only `repo.*`, never drizzle.
- [ ] Move private helpers under `internal/`.
- [ ] Rename "junk-drawer" files (`helpers.ts`, `utils.ts`, `misc.ts`) to responsibility-driven names.
- [ ] Split files exceeding hard caps (see [`module-layout.md`](module-layout.md)). Use directories with `index.ts`.
- [ ] Convert deep imports from other modules into barrel imports. If you need a name not yet exposed, extend that module's `index.ts` in the same PR.
- [ ] Convert deep imports into your module (from other modules) into barrel re-exports.
- [ ] If the module emits events, formalize them in `events.ts` and switch emit sites to typed `emit(...)`.
- [ ] Convert any top-level `on(...)` calls to `register<X>()` exports. Add `jobs/index.ts` with `registerJobs()`.
- [ ] Re-export `registerJobs` from `index.ts`. Wire into entry points if not already.
- [ ] Enable boundaries test coverage for this module (remove any temporary skip).
- [ ] `vp check` + `vp test` clean. `fallow dead-code` shows `boundary_violations: []` for this module.
- [ ] Changeset: `minor` if external surface changed; empty frontmatter if pure refactor.

## PR review

When reviewing a module-folder PR, cite hard-rule numbers from [`SKILL.md`](../SKILL.md).

- [ ] Rule 1 — no deep imports of another module's `repo.ts`, `internal/`, `jobs/<x>.ts`. Barrel only.
- [ ] Rule 2 — `drizzle-orm` imports only in `repo.ts` / `repo/**`.
- [ ] Rule 3 — `@owner:` directive matches the importing module's `repo.ts`.
- [ ] Rule 4 — cross-module side effects go through typed `emit(...)`, not direct function calls.
- [ ] Rule 5 — `events.ts` changes carry a changeset entry.
- [ ] Rule 6 — tests next to code, mock `repo.ts`.
- [ ] Rule 7 — one handler file per event; `register<X>()` export pattern.
- [ ] Rule 8 — `internal/` not imported from outside.
- [ ] Rule 9 — no static cycles; runtime cycles documented if they exist.
- [ ] Rule 10 — adapters call barrels only.
- [ ] Rule 11 — no junk-drawer filenames.
- [ ] Rule 12 — event names referenced via constant, never literal.
- [ ] Boot order: `registerJobs` re-exported from barrel; entry points call alphabetically.
- [ ] Size and complexity budgets respected (see [`module-layout.md`](module-layout.md)).
- [ ] Companion skills invoked (esp. `clean-code` for function-level scrutiny).

## See also

- [`SKILL.md`](../SKILL.md) — hard rules.
- [`module-layout.md`](module-layout.md), [`service-and-repo.md`](service-and-repo.md), [`events-and-jobs.md`](events-and-jobs.md), [`db-ownership.md`](db-ownership.md), [`fallow-zones.md`](fallow-zones.md).
- Worked examples: [`examples/new-module.md`](examples/new-module.md), [`examples/add-event.md`](examples/add-event.md), [`examples/retrofit-existing.md`](examples/retrofit-existing.md).

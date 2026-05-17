# Checklists

## New module

- [ ] Name = real domain (not infra, not adapter)
- [ ] Folder `apps/server/src/<module>/` w/ canonical layout → [module-layout.md](module-layout.md)
- [ ] `index.ts` barrel re-exports: service + events + errors + types + `registerJobs`
- [ ] `service.ts` — class + `get<Module>Service()` factory, no drizzle imports
- [ ] `repo.ts` — drizzle queries on owned tables only. Sole drizzle import site
- [ ] `errors.ts` — base error + subclasses
- [ ] `types.ts` — public domain types, pure
- [ ] `events.ts` (if emits) — `<MODULE>_EVENTS as const` + zod schemas + types
- [ ] `jobs/` — one handler file per event; `jobs/index.ts` aggregates via `registerJobs()`, no top-level `on(...)`
- [ ] `internal/` — private helpers
- [ ] `__tests__/` — unit tests mocking `repo.ts`
- [ ] Add 2 zones to `.fallowrc.json` (narrow first) + 2 rules → [fallow-zones.md](fallow-zones.md)
- [ ] Update other modules' + adapter rules to include `server-mod-<new>` where needed
- [ ] Annotate new drizzle schema files `// @owner: <module>` → [db-ownership.md](db-ownership.md)
- [ ] Wire `<module>.registerJobs()` into `{index,worker}.ts` alphabetically
- [ ] Companion skills invoked: `clean-code`, `fallow`, `es-toolkit`, `backprop`; `frontend-feature-architecture` if paired
- [ ] Changeset added (CLAUDE.md versioning)
- [ ] `vp check` + `vp test` clean; `fallow dead-code` → `boundary_violations: []`
- [ ] `tools/check-table-ownership.ts` + `tools/check-file-sizes.ts` green

## Retrofit

- [ ] Inventory: list files, map each to reserved role
- [ ] Extract `repo.ts` from existing data-access code; `service.ts` calls only `repo.*`, never drizzle
- [ ] Move private helpers under `internal/`
- [ ] Rename junk-drawer files (`helpers/utils/misc.ts`) to responsibility-driven names
- [ ] Split files exceeding hard caps → dirs with `index.ts` (see [module-layout.md](module-layout.md))
- [ ] Convert deep imports FROM other modules → barrel imports; extend that barrel if name not yet exposed
- [ ] Convert deep imports INTO this module (from other modules) → barrel re-exports
- [ ] Events: formalize in `events.ts`, switch emit sites to typed `emit(...)`
- [ ] Convert top-level `on(...)` calls → `register<X>()` exports; add `jobs/index.ts` w/ `registerJobs()`
- [ ] Re-export `registerJobs` from `index.ts`; wire entry points if not done
- [ ] Enable boundaries test coverage for module (remove any temp skip)
- [ ] `vp check` + `vp test` clean; `fallow dead-code` → `boundary_violations: []` for this module
- [ ] Changeset: `minor` if external surface changed; empty frontmatter if pure refactor

## PR review

Cite hard-rule numbers from [SKILL.md](../SKILL.md).

- [ ] R1 — no deep imports of `repo.ts`, `internal/`, `jobs/<x>.ts` from outside. Barrel only
- [ ] R2 — `drizzle-orm` imports only in `repo.ts` / `repo/**`
- [ ] R3 — `@owner:` matches importing module's `repo.ts`
- [ ] R4 — cross-mod side effects via typed `emit(...)`, not direct calls
- [ ] R5 — `events.ts` changes carry changeset
- [ ] R6 — tests next to code, mock `repo.ts`
- [ ] R7 — one handler file per event; `register<X>()` export pattern
- [ ] R8 — `internal/` not imported from outside
- [ ] R9 — no static cycles; runtime cycles documented
- [ ] R10 — adapters call barrels only
- [ ] R11 — no junk-drawer filenames
- [ ] R12 — event names via constant, never literal
- [ ] R13 — new error codes registered in `packages/shared/src/diagnostics/codes.ts` w/ correct severity; expected user-state → `info`, recovered → `warning`, fault → `error`
- [ ] R14 — service methods that handle expected plugin absence (no connection, token expired) catch typed error at service boundary; ⊥ naked `PluginCallError` reaches HTTP boundary
- [ ] Boot: `registerJobs` re-exported from barrel; entry points call alphabetically
- [ ] Size + complexity budgets respected → [module-layout.md](module-layout.md)
- [ ] Companion skills invoked (esp. `clean-code` for fn-level scrutiny)

## See also

- [SKILL.md](../SKILL.md), [module-layout.md](module-layout.md), [service-and-repo.md](service-and-repo.md), [events-and-jobs.md](events-and-jobs.md), [db-ownership.md](db-ownership.md), [fallow-zones.md](fallow-zones.md)
- Examples: [new-module.md](examples/new-module.md), [add-event.md](examples/add-event.md), [retrofit-existing.md](examples/retrofit-existing.md)

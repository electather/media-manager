---
goal: Convert apps/server/src/ into a modular monolith with fallow-enforced per-module boundaries, barrel-only public APIs, async events via jobs/ infra, DB ownership convention, and a `backend-feature-architecture` Claude skill
version: 1.0
date_created: 2026-05-17
last_updated: 2026-05-17
owner: Omid Astaraki
status: 'Planned'
tags: [architecture, refactor, infrastructure]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Execute the design at `docs/2026-05-17-backend-feature-architecture-design.md`. Four phases land in order: Phase 1 splits the fallow `server-domains` mega-zone into 8 per-module zones plus 8 `-internal` sub-zones, fixes 71 deep cross-module imports via trivial barrel re-exports, and lands the table-ownership + file-size pre-commit scripts. Phase 2 retrofits `notifications/` to the canonical flat-with-reserved-files shape, ships the typed `emit`/`on` wrapper around `jobs/`, and authors the `backend-feature-architecture` skill at `.agents/skills/`. Phase 3 retrofits the remaining seven modules in sequence: `preferences/`, `auth/`, `artwork/`, `catalog/`, `home/`, `media/`, `plugin-runtime/`. Phase 4 (per-module schema namespaces) is deferred to a separate spec.

## 1. Requirements & Constraints

- **REQ-001**: Each domain module (`artwork`, `auth`, `catalog`, `home`, `media`, `notifications`, `preferences`, `plugin-runtime`) MUST expose a single public surface via `index.ts`. Deep imports into `repo.ts`, `internal/`, or `jobs/` from outside the module are forbidden.
- **REQ-002**: Inter-module sync calls MUST go through the importing module's barrel-exported service. Direct `drizzle-orm` imports are restricted to `<module>/repo.ts` (or `<module>/repo/**` after promotion).
- **REQ-003**: Inter-module async signals MUST use the typed `emit(name, schema, payload)` / `on(name, schema, handler)` wrapper exported from `apps/server/src/jobs/events.ts`. Raw `enqueue`/`registerJob` are reserved for in-module scheduled work.
- **REQ-004**: Each drizzle table MUST have a single owning module declared as `// @owner: <module>` or `// @owner(<tableName>): <module>` at the top of its schema file. Only the owning module's `repo.ts` may import that table.
- **REQ-005**: Handler registration MUST occur via `<module>.registerJobs()` invoked from `apps/server/src/index.ts` and `apps/server/src/worker.ts` in fixed alphabetical order. No top-level `on(...)` calls.
- **REQ-006**: `notifications/` is the canonical exemplar; `apps/server/src/__tests__/boundaries.test.ts` asserts it matches the template.
- **REQ-007**: `.agents/skills/backend-feature-architecture/` ships with `SKILL.md` (≤220 LOC) + 6 references + 3 examples + `metadata.json`, symlinked from `.claude/skills/backend-feature-architecture`.
- **SEC-001**: No new dependency introduced for fallow enforcement; AST tooling (table-ownership script + boundaries test) uses `ts-morph` if already in `apps/server/package.json`, otherwise the TypeScript compiler API.
- **CON-001**: Phase 4 (per-module schema namespaces) is out of scope for this plan.
- **CON-002**: Phase 1 PR may be split into 1a (zone scaffolding + scripts) and 1b (71 import fixes) if the diff exceeds ~40 changed files.
- **CON-003**: Phase 3 must execute one module per PR; no bundled module retrofits.
- **CON-004**: `jobs/` is **infra**, not a module. It folds into `server-infra`. `<module>/jobs/**` belongs to `server-mod-<x>-internal`, not `server-infra`.
- **GUD-001**: Every commit passes `vp check` and `vp test` (per `CLAUDE.md` and memory guardrails #8/#9).
- **GUD-002**: Function size ≤50 LOC, cyclomatic ≤15 for module code. File-size caps: `service.ts` 500 hard, `repo.ts` 300 hard, `events.ts` 200 hard, `jobs/<x>.ts` 200 hard.
- **GUD-003**: No `utils.ts`, `helpers.ts`, `misc.ts` filenames in modules. Junk-drawer names are rejected by pre-commit.
- **PAT-001**: Flat-with-reserved-files layout per module: `index.ts`, `service.ts`, `events.ts`, `errors.ts`, `types.ts`, `repo.ts`, `jobs/<x>.ts`, `internal/<helper>.ts`, `__tests__/`. Files exist only when the role is needed.
- **PAT-002**: Fallow zone ordering follows first-match-wins (per `BoundaryZone` schema): the narrower `<module>` zone (matching `index.ts` only) is listed before the broader `<module>-internal` zone (matching `<module>/**`). No negated globs.
- **PAT-003**: Event naming: `<module>.<entity>.<verb-past-tense>`, lower-kebab segments. Example: `catalog.media.added`.
- **PAT-004**: Cross-module event payload imports go through the producer's barrel (`import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog"`), never `../../catalog/events`.

## 2. Implementation Steps

### Implementation Phase 1 — Boundary scaffolding + pre-commit enforcement

- GOAL-001: Replace the fallow `server-domains` mega-zone with per-module zones, lock `server-infra`, fix all 71 deep cross-module imports via barrel re-exports, and land the table-ownership + file-size pre-commit scripts. Exit: `vp check`, `vp test`, `fallow dead-code` (boundary_violations: 0), `fallow health`, `tools/check-table-ownership.ts`, `tools/check-file-sizes.ts` all green.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Spike: validate first-match-wins on `preferences/`. Add 2 zones (`server-mod-preferences` matching `apps/server/src/preferences/index.ts`; `server-mod-preferences-internal` matching `apps/server/src/preferences/**`), 2 rules (allow standard list). Run `fallow dead-code --format json`; confirm `index.ts` classified to public zone, other files to internal. Document outcome inline in `docs/2026-05-17-backend-feature-architecture-design.md` Open Questions §2. | | |
| TASK-002 | Edit `.fallowrc.json`. Remove `server-domains` zone. Remove `server-domains` from any `allow` list. Add 8 pairs of zones: `server-mod-{artwork,auth,catalog,home,media,notifications,preferences,plugin-runtime}` + `server-mod-{...}-internal`, narrower listed first per PAT-002. | | |
| TASK-003 | Edit `.fallowrc.json` zone for `server-infra`: patterns become `["apps/server/src/db/**", "apps/server/src/cache/**", "apps/server/src/crypto/**", "apps/server/src/connections/**", "apps/server/src/diagnostics/**", "apps/server/src/jobs/**"]`. | | |
| TASK-004 | Edit `.fallowrc.json` rules: per-module rule allows `server-mod-<x>-internal`, `server-infra`, all other `server-mod-<y>` barrels, `shared-pkg`, `plugin-sdk`. `server-mod-<x>-internal` rule allows same + own barrel. `server-mod-plugin-runtime` and `server-mod-plugin-runtime-internal` additionally allow `plugins`. `server-infra` allow list = `["shared-pkg", "plugin-sdk"]` only. | | |
| TASK-005 | Edit `.fallowrc.json` rules for adapters: `server-api` allows all `server-mod-*` barrels + `server-infra` + `shared-pkg` + `plugin-sdk` + `server-mcp`. `server-mcp` allows all `server-mod-*` barrels + `server-infra` + `shared-pkg` + `plugin-sdk`. Modules MUST NOT have `server-api` or `server-mcp` in their allow lists. | | |
| TASK-006 | Edit `.fallowrc.json` rules.circular-deps: change from `warn` to `error`. Verify `unused-files`, `unused-exports` remain `error`. | | |
| TASK-007 | Edit `.fallowrc.json` health: lower `maxCyclomatic` to 15. Add `apps/server/src/api/**`, `apps/server/src/mcp/**` to `health.ignore`. | | |
| TASK-008 | Run `fallow dead-code --format json --quiet 2>/dev/null \| jq '.boundary_violations'` and snapshot the output as `docs/internal/2026-05-17-phase1-violations.json` (gitignored is fine if listing is sensitive). Expected: a list of the 71 deep imports from Appendix A. | | |
| TASK-009 | For each of the 71 deep imports in Appendix A, add a barrel re-export from the target module's `index.ts`. Strategy per target: (a) named class/type → `export { Foo } from "./service"` or `export type * from "./types"`; (b) factory accessor → `export { getFooService } from "./service"`; (c) job helper → move to `internal/` if not part of public surface, otherwise re-export. Update the consumer to `import { Foo } from "../<module>"`. Do NOT convert `notifications/emit` ×3 calls to events in this phase (see TASK-024 in Phase 2). | | |
| TASK-010 | Track every Phase 1 `fallow-allow` suppression. Current count: 14 total — 3 `phase-2 event conversion` imports (`plugin-runtime/context.ts`, `jobs/runner.ts`, `media/connection-lifecycle.ts`) and 11 `phase-2 infra-to-module decoupling` imports (`connections/auth.ts`, `connections/helpers.ts`, `connections/service.ts` ×2, `db/seed.ts`, `jobs/plugin-jobs.ts`, `jobs/scheduler.ts` ×5). Each suppression must keep the strict adjacent two-line pattern: `// fallow-allow: <reason>` followed immediately by `// fallow-ignore-next-line boundary-violation`. | | |
| TASK-011 | Create `tools/check-file-sizes.ts` (Node script). For each file under `apps/server/src/{artwork,auth,catalog,home,media,notifications,preferences,plugin-runtime}/**/*.ts`, compute LOC. Hard-fail rules: `service.ts` >500, `repo.ts` >300, `events.ts` >200, `jobs/**/*.ts` >200 (excluding `index.ts`). Soft-warn at 80% of hard cap. Exit 1 on hard fail. Wire into `package.json` `staged` lifecycle (or `vp staged` configuration) and into CI. | | |
| TASK-012 | Create `tools/check-table-ownership.ts` (Node script). Parse `apps/server/src/db/schema/**/*.ts` for `// @owner: <module>` directives at file top and `// @owner(<tableName>): <module>` directives next to table declarations. Build map `tableExportName → module`. Walk `apps/server/src/<module>/**/*.ts` (excluding adapters); for each named import resolving to `apps/server/src/db/schema/*`, assert **both**: (a) the imported identifier's owning module matches the importing module's directory, **AND** (b) the importing file is `<module>/repo.ts` or `<module>/repo/**`. Any import that fails either condition is a violation — a non-owner `repo.ts` such as `home/repo.ts` importing a `catalog` table fails condition (a) and must be rejected. Resolve TS path aliases via `tsconfig.json`. Use `ts-morph` if declared in `apps/server/package.json`, else use the TypeScript compiler API. Exit 1 on violations. Wire into `staged` + CI. | | |
| TASK-013 | Annotate every drizzle schema file under `apps/server/src/db/schema/**/*.ts` with `// @owner: <module>` directives. Use the assignment from §"DB ownership" / Appendix A. Where a file declares tables owned by different modules, split it into separate files (one file per owner) before annotating. | | |
| TASK-014 | Add `tools/check-file-sizes.ts` and `tools/check-table-ownership.ts` to `vp staged` configuration (or pre-commit equivalent in this repo's setup). | | |
| TASK-015 | Create `.changeset/architecture-backend-boundaries-phase1.md` with frontmatter `--- "@ent-mcp/server": minor ---` and a one-line user-facing description per `CLAUDE.md` Pull Requests and Versioning rules. | | |
| TASK-016 | Run `vp check` and `vp test`. Fix any flagged issues. Run `fallow dead-code --format json --quiet 2>/dev/null \| jq '.boundary_violations \| length'`. MUST return 0 with only the 14 tagged Phase 1 suppressions listed in TASK-010 deferred to Phase 2/3. | | |

### Implementation Phase 2 — `notifications/` exemplar retrofit + `backend-feature-architecture` skill

- GOAL-002: Retrofit `notifications/` to the canonical flat-with-reserved shape, ship the typed `emit`/`on` wrapper in `jobs/events.ts`, convert the 3 deferred `notifications/emit` call sites into proper events, author the `backend-feature-architecture` skill at `.agents/skills/`, and add the `boundaries.test.ts` + `boot.test.ts` integration tests. Exit: `notifications/` passes the boundaries test; skill is symlinked and discoverable; `vp check`, `vp test`, `fallow dead-code` all green.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | Create `apps/server/src/jobs/events.ts`. **Note:** `enqueue` and `registerJob` are new lower-level primitives that do not yet exist in the jobs package — this task must add them, or implement `emit`/`on` directly on top of `registerTriggerable`. Recommended approach: add `enqueue(name: string, payload: unknown): Promise<void>` (schedules an immediate triggerable run) and `registerJob(name: string, handler: (raw: unknown) => Promise<void>): void` (registers the dispatcher using `registerTriggerable`) as module-internal helpers in `events.ts`. Export branded `EventName` type, module-level `Map<string, Array<(raw: unknown) => Promise<void>>>` handler registry, `emit<P>(name, schema, payload)` (validates with zod, calls internal `enqueue`), and `on<P>(name, schema, handler)` (appends to handler list; on first call per event name, registers single dispatcher via internal `registerJob` that iterates the list sequentially). Code matches §"Typed wrapper around `jobs/` for events". | | |
| TASK-018 | Add unit tests `apps/server/src/jobs/__tests__/events.test.ts`: (a) single handler registration + dispatch happy path, (b) fan-out: multiple `on(...)` for same event invoke all handlers in order, (c) handler throw aborts remaining handlers and propagates to runner, (d) zod validation failure at `emit` rejects without enqueueing, (e) zod validation failure at dispatch propagates to runner. | | |
| TASK-019 | Refactor `apps/server/src/notifications/`. Target structure: `index.ts`, `service.ts`, `events.ts`, `errors.ts`, `types.ts`, `repo.ts`, `jobs/index.ts`, `jobs/<handler>.ts` (one per event handled), `internal/<helper>.ts`, `templates/` (already exists, stays), `__tests__/`. Move private helpers (`resolve-recipients.ts`, `delivery-policy.ts`, `stale-pending-sweep.ts`, `demo-job.ts`, `delivery-job.ts`, `error-sink.ts`) into `internal/` or `jobs/` per their role. Extract `repo.ts` from the existing `repos.ts` (rename and adjust signatures so `service.ts` calls `repo.*`, not drizzle). | | |
| TASK-020 | Create `apps/server/src/notifications/events.ts` declaring `NOTIFICATIONS_EVENTS` const + zod payload schemas + derived types for any event `notifications` itself emits (currently emitted via `emit.ts`; replace those emissions to use the new typed wrapper). | | |
| TASK-021 | Refactor `apps/server/src/notifications/service.ts` to expose a class plus a `getNotificationsService()` factory accessor. Remove direct drizzle imports — call `repo.*` instead. | | |
| TASK-022 | Create `apps/server/src/notifications/jobs/index.ts` exporting `registerJobs(): void` that calls every `register<X>()` from sibling handler files. Each handler file exports `register<X>(): void` that calls `on(EVENT, schema, handler)`. No top-level `on(...)` calls. | | |
| TASK-023 | Write `apps/server/src/notifications/index.ts` (barrel). Re-export `NotificationsService`, `getNotificationsService` from `./service`; `NOTIFICATIONS_EVENTS`, payload schemas, payload types from `./events`; error classes from `./errors`; public types from `./types`; `registerJobs` from `./jobs`. MUST NOT re-export from `repo.ts`, `internal/`, or `jobs/<x>.ts`. | | |
| TASK-024 | Convert the 3 `notifications/emit` ×3 call sites identified in TASK-010 to use the typed `emit(...)` wrapper. Source modules emit `<source>.<entity>.<verb>` events declared in their own `events.ts`. `notifications/jobs/on-<source>-<event>.ts` handlers consume them and call `notifications.service.notifyX(...)`. Remove the inline `// fallow-allow:` tags and the matching fallow ignore entries from TASK-010. | | |
| TASK-025 | Edit `apps/server/src/index.ts` and `apps/server/src/worker.ts`. Import each module's barrel; call `<module>.registerJobs()` in fixed alphabetical order (`artwork`, `auth`, `catalog`, `home`, `media`, `notifications`, `preferences`, `plugin-runtime`). For modules without `jobs/` yet, no call. For Phase 2, only `notifications.registerJobs()` is wired; Phase 3 wires the rest. | | |
| TASK-026 | Create `apps/server/src/__tests__/boundaries.test.ts`. For each module: assert `index.ts` exists; parse `index.ts` AST; assert re-exports originate only from `./service`, `./events`, `./errors`, `./types`, `./jobs` (allowed names: service class, factory accessor, event constants, payload schemas, payload types, error classes, public types, `registerJobs`); assert no re-exports from `./repo`, `./internal`, individual handler files. For every `.ts` file under `apps/server/src/<x>/**` (`x` ≠ current module), parse imports; assert no import resolves to `<current>/repo.ts`, `<current>/internal/**`, or `<current>/jobs/<handler>.ts`. Use the same AST library as `tools/check-table-ownership.ts`. Phase 2 runs the test against `notifications/` only; Phase 3 enables it for the rest. | | |
| TASK-027 | Create `apps/server/src/__tests__/boot.test.ts`. In a fresh process, import `apps/server/src/index.ts`, observe the order of `<module>.registerJobs()` calls (instrumenting via a test-only shim). Assert alphabetical order. For every event name declared in any `<module>/events.ts`, assert at least one `on(...)` registration exists after `registerJobs()` completes. | | |
| TASK-028 | Create the skill directory `.agents/skills/backend-feature-architecture/` with subdirs `references/` and `references/examples/`. | ✅ | 2026-05-17 |
| TASK-029 | Write `.agents/skills/backend-feature-architecture/SKILL.md` (≤220 LOC). Frontmatter `name`, `description`, `metadata.version: "1.0.0"`. Body sections: module map, decision tree (new module vs retrofit), 12 hard rules (numbered, matching §"Hard rules" in the design), companion skills table (clean-code, fallow, es-toolkit, backprop, frontend-feature-architecture), section index linking to references, canonical example pointer to `apps/server/src/notifications/`. | ✅ | 2026-05-17 |
| TASK-030 | Write `.agents/skills/backend-feature-architecture/references/module-layout.md` covering flat-with-reserved-files layout, reserved file roles table, promotion rules, size/complexity budgets. | ✅ | 2026-05-17 |
| TASK-031 | Write `.agents/skills/backend-feature-architecture/references/service-and-repo.md` covering sync API contract via barrel-exported service, drizzle-isolation rule (only `repo.ts` imports `drizzle-orm`), factory accessor pattern. | ✅ | 2026-05-17 |
| TASK-032 | Write `.agents/skills/backend-feature-architecture/references/events-and-jobs.md` covering typed `emit`/`on` wrapper, event naming convention (PAT-003), boot order (alphabetical), fan-out semantics, runtime cycle pattern with sequence diagram, choosing sync vs async heuristic. | ✅ | 2026-05-17 |
| TASK-033 | Write `.agents/skills/backend-feature-architecture/references/db-ownership.md` covering `@owner:` directive grammar, `tools/check-table-ownership.ts` behavior, one-owner-per-table rule, multi-table-per-file split rule. | ✅ | 2026-05-17 |
| TASK-034 | Write `.agents/skills/backend-feature-architecture/references/fallow-zones.md` covering first-match-wins ordering, two-zone-per-module pattern, allow-list contract, severity, health budgets, infra carve-out for `<module>/jobs/**`. | ✅ | 2026-05-17 |
| TASK-035 | Write `.agents/skills/backend-feature-architecture/references/checklist.md` covering new-module checklist + retrofit checklist + PR review checklist (cite rule numbers). | ✅ | 2026-05-17 |
| TASK-036 | Write `.agents/skills/backend-feature-architecture/references/examples/new-module.md`, `add-event.md`, `retrofit-existing.md`. Each example is concrete and copies the `notifications/` shape. | ✅ | 2026-05-17 |
| TASK-037 | Write `.agents/skills/backend-feature-architecture/metadata.json` matching the shape of `.agents/skills/frontend-feature-architecture/metadata.json`. | ✅ | 2026-05-17 |
| TASK-038 | Create symlink `.claude/skills/backend-feature-architecture → ../../.agents/skills/backend-feature-architecture`. Verify the symlink with `ls -la .claude/skills/backend-feature-architecture`. | ✅ | 2026-05-17 |
| TASK-039 | Edit root `CLAUDE.md`. Add a Backend Skills block mirroring the Frontend Skills block (line 73 onward in current `CLAUDE.md`). Specify trigger: `∀ change @ apps/server/src/<module>/ → skill ! before edit: backend-feature-architecture`. Skip @ adapters (`api/`, `mcp/`) and infra. | | |
| TASK-040 | Create `.changeset/architecture-backend-boundaries-phase2.md`. Frontmatter: `--- "@ent-mcp/server": minor ---`. Body: one-line user-facing description. | | |
| TASK-041 | Run `vp check`, `vp test`, `fallow dead-code`, `tools/check-table-ownership.ts`, `tools/check-file-sizes.ts`. All MUST be green. | | |

### Implementation Phase 3 — Per-module retrofit (one PR per module)

- GOAL-003: Retrofit the remaining seven domain modules in size-ascending order. Each PR: applies the canonical layout, wires `registerJobs()` from the barrel into entry-point files, fixes any module-specific deep imports introduced after Phase 1, runs the boundaries test against the now-eligible module. Exit per PR: `vp check`, `vp test`, `fallow dead-code`, `tools/check-table-ownership.ts`, boundaries test for the affected module all green.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-042 | Retrofit `apps/server/src/preferences/`. Apply canonical layout (PAT-001). Extract `repo.ts` from existing data-access code. Move private helpers under `internal/`. Add `service.ts` with `getPreferencesService()` factory. Author `events.ts` only if the module emits events (today: yes — `preferences/jobs` referenced from elsewhere). Wire `preferences.registerJobs()` into `apps/server/src/{index,worker}.ts`. Enable boundaries test coverage for `preferences/`. Add changeset (`@ent-mcp/server: minor`). | | |
| TASK-043 | Retrofit `apps/server/src/auth/`. Same procedure as TASK-042. Surface: `getAuthService()`, OAuth config helpers, permission helpers re-exported via barrel. Add changeset. | | |
| TASK-044 | Retrofit `apps/server/src/artwork/`. Same procedure. Surface: `getArtworkService()`, artwork-resolution types via barrel. Add changeset. | | |
| TASK-045 | Retrofit `apps/server/src/catalog/`. `service.ts` (~21 KB) splits into `service/` directory. One file per responsibility: `canonicalize.ts`, `features.ts`, `search.ts`, etc. No `helpers.ts` or `utils.ts` (GUD-003). Re-export public methods from `service/index.ts`; remove the temporary `writeRecommendationsForUser` job-function export from the public barrel. Same boundary, test, and changeset procedure. | | |
| TASK-046 | Retrofit `apps/server/src/home/`. Convert deep imports into `media/`, `catalog/`, `notifications/`, `preferences/` to barrel imports (extending those modules' `index.ts` if needed). Move `orchestrator.ts`, `enrich.ts`, `match-reason.ts`, `hero.ts`, `layout-cache.ts`, `season-availability.ts`, `status-batch.ts` under `internal/`. Keep `rows/` and `jobs/` as documented; remove the temporary `registerHomeLayoutWarmJob` job-function export from the public barrel. Same procedure. | | |
| TASK-047 | Retrofit `apps/server/src/media/`. `service.ts` (~33 KB) splits into `service/` directory: `dispatch.ts`, `invoke.ts`, `id-resolver.ts`, `primary-preference.ts`, `compact.ts`, `connection-lifecycle.ts`, `connection-targeted.ts`, etc. Move `strategies/`, `parse-item.ts`, `capability-lookup.ts`, `resolve-connection.ts`, `dispatch-cache.ts` under `internal/`. Re-export public types and accessor from `index.ts`. Same procedure. | | |
| TASK-048 | Retrofit `apps/server/src/plugin-runtime/`. `runtime.ts` (~32 KB) splits into a directory of role-named files. Surface: `getPluginRuntime()` accessor + types via barrel. Same procedure. | | |
| TASK-049 | After all seven module retrofits, enable boundaries test for the complete module set. Run the full suite (`vp check`, `vp test`, `fallow dead-code`) one final time. Expected: zero violations, zero allowlist entries. | | |

### Implementation Phase 4 — Per-module schema namespaces (deferred to separate spec)

- GOAL-004: Track this phase as a follow-up spec. Not executed in this plan.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-050 | Create follow-up spec at `docs/<YYYY-MM-DD>-backend-schema-namespaces-design.md` covering: split `db/schema/` into `db/schema/<module>/`; add per-module `server-mod-<x>-schema` fallow zone; tighten module rules to allow only own schema namespace. Out of scope for this plan. | | |

## 3. Alternatives

- **ALT-001**: Layered (api/domain/infra subfolders) per module instead of flat-with-reserved-files. Rejected: heavy ceremony for modules averaging 5–17 files; layered separation more valuable in OOP-heavy stacks than functional TS; TypeScript already provides type-safety boundaries.
- **ALT-002**: All cross-module communication via events (no sync calls). Rejected: home page composes catalog + media + status synchronously; turning sync reads into events would reinvent RPC and kill latency.
- **ALT-003**: Separate in-memory event emitter for non-durable signals, alongside `jobs/` for durable signals. Rejected: introduces two patterns and a classification rule; 95% of cross-module signals want durability; the 5% (cache invalidation) is already solved by direct calls into `cache/`.
- **ALT-004**: Per-module schema namespaces in Phase 1 (not deferred). Rejected: migrations stay global; structural enforcement on schema is a tightening on top of convention, not the only enforcement line.
- **ALT-005**: Big-bang refactor in a single PR sequence. Rejected: large risk, blocks feature work, harder to review. Sequenced per-module retrofit chosen.
- **ALT-006**: Warn-window on boundary violations before flipping to error. Rejected: violations accrue as debt; clean cut is cheaper than maintained allowlist.
- **ALT-007**: Single combined `feature-architecture` skill covering frontend + backend. Rejected: long file, mixed concerns, decision tree branches early on which half applies; symmetry with separate frontend skill preserved.

## 4. Dependencies

- **DEP-001**: `fallow` CLI (already installed via Vite+ at `~/.vite-plus/bin/fallow`, version 2.54.3). Schema verified to support first-match-wins zone membership.
- **DEP-002**: `ts-morph` (verify presence in `apps/server/package.json` during TASK-001 spike; fall back to TypeScript compiler API if absent).
- **DEP-003**: Existing `jobs/` infrastructure at `apps/server/src/jobs/`: `enqueue`, `registerJob`, runner, history, scheduler. Phase 2 adds `jobs/events.ts` on top; no changes to runner internals required.
- **DEP-004**: `zod` (already in `@ent-mcp/shared` catalog).
- **DEP-005**: Existing `@ent-mcp/shared` package for cross-package types — no changes required.
- **DEP-006**: `.agents/skills/frontend-feature-architecture/` exists at `.agents/skills/frontend-feature-architecture/` — used as the structural reference for the new skill.

## 5. Files

- **FILE-001**: `.fallowrc.json` — replace `server-domains` zone with 8 module zone pairs; tighten `server-infra`; add per-module rules; flip `circular-deps` to error; lower `maxCyclomatic` to 15.
- **FILE-002**: `tools/check-file-sizes.ts` — new pre-commit/CI script enforcing file-size caps.
- **FILE-003**: `tools/check-table-ownership.ts` — new pre-commit/CI script enforcing `@owner:` ↔ repo import map.
- **FILE-004**: `apps/server/src/db/schema/**/*.ts` — add `@owner:` directives; split multi-owner files.
- **FILE-005**: `apps/server/src/jobs/events.ts` — new typed `emit`/`on` wrapper.
- **FILE-006**: `apps/server/src/jobs/__tests__/events.test.ts` — unit tests for the wrapper.
- **FILE-007**: `apps/server/src/notifications/{index,service,events,errors,types,repo}.ts` + `jobs/index.ts` + `jobs/<handler>.ts` + `internal/<helper>.ts` — canonical exemplar retrofit.
- **FILE-008**: `apps/server/src/index.ts`, `apps/server/src/worker.ts` — wire `<module>.registerJobs()` calls in alphabetical order.
- **FILE-009**: `apps/server/src/__tests__/boundaries.test.ts` — new integration test enforcing barrel-only entry.
- **FILE-010**: `apps/server/src/__tests__/boot.test.ts` — new integration test enforcing deterministic boot order + handler-presence coverage.
- **FILE-011**: `.agents/skills/backend-feature-architecture/{SKILL.md,metadata.json,references/*.md,references/examples/*.md}` — new skill artifact.
- **FILE-012**: `.claude/skills/backend-feature-architecture` — symlink into `.agents/skills/backend-feature-architecture`.
- **FILE-013**: `CLAUDE.md` (root) — add Backend Skills block mirroring Frontend Skills block.
- **FILE-014**: `apps/server/src/{artwork,auth,catalog,home,media,preferences,plugin-runtime}/**` — Phase 3 retrofits (canonical layout per module).
- **FILE-015**: `apps/server/package.json` — verify `ts-morph` presence; add if absent (DEP-002).
- **FILE-016**: `.changeset/architecture-backend-boundaries-phase1.md`, `…-phase2.md`, plus one changeset per Phase 3 module PR.
- **FILE-017**: `docs/2026-05-17-backend-feature-architecture-design.md` — design doc updated inline during TASK-001 spike with first-match-wins confirmation.

## 6. Testing

- **TEST-001**: `apps/server/src/jobs/__tests__/events.test.ts` — unit tests covering single-handler dispatch, multi-handler fan-out, throw-aborts-rest behavior, zod validation at `emit` and at dispatch.
- **TEST-002**: `apps/server/src/__tests__/boundaries.test.ts` — for each module: `index.ts` exists; AST analysis confirms re-exports come only from approved files; no external file references `<module>/repo.ts`, `<module>/internal/**`, `<module>/jobs/<x>.ts`; entry-point files (`apps/server/src/{index,worker}.ts`) are explicitly carved out as the only place that may import `<module>.registerJobs()` (which still goes through the barrel — no carve-out actually needed at the boundary-test level).
- **TEST-003**: `apps/server/src/__tests__/boot.test.ts` — in a fresh process, `registerJobs()` calls observed in alphabetical order; every event name declared in any `<module>/events.ts` has at least one `on(...)` registration after `registerJobs()` completes.
- **TEST-004**: `tools/check-table-ownership.ts` — exit 0 in CI; invoked also by `vp staged` on commit.
- **TEST-005**: `tools/check-file-sizes.ts` — exit 0 in CI; invoked also by `vp staged`.
- **TEST-006**: `fallow dead-code --format json --quiet 2>/dev/null` — CI fails if `.boundary_violations` is non-empty.
- **TEST-007**: `fallow health --format json --quiet 2>/dev/null` — CI fails if module-code function exceeds cyclomatic 15 or cognitive 15.
- **TEST-008**: Existing module-level unit tests under each `<module>/__tests__/` continue to pass after retrofit (no test deletions; only refactor of `repo` mocking surface).
- **TEST-009**: `vp check` (format, lint, typecheck) green on every commit.
- **TEST-010**: `vp test` (vitest suite) green on every commit.

## 7. Risks & Assumptions

- **RISK-001**: TASK-001 spike reveals fallow's first-match-wins behavior diverges from the schema documentation. Mitigation: fall back to convention + grep pre-commit (`tools/check-deep-imports.ts`) and document the decision in the design.
- **RISK-002**: Phase 1's 71 import fixes balloon into 100+ when accounting for transitive deep imports introduced by adding new barrel exports. Mitigation: Phase 1 PR may be split into 1a + 1b per CON-002.
- **RISK-003**: `service.ts` splits in Phase 3 (`catalog`, `home`, `media`, `plugin-runtime`) take significantly longer than estimated because responsibility design is non-trivial for ~30 KB files. Mitigation: effort table already includes a 1.5× factor; allow PR sequencing to spill if needed.
- **RISK-004**: Pre-commit scripts (`check-file-sizes`, `check-table-ownership`) block emergency fixes during incidents. Mitigation: hard cap only on hard limit; CI bypass available with explicit `--allow-large-files` flag and PR-description justification.
- **RISK-005**: Boot-order test (`boot.test.ts`) is flaky if module load order is affected by test parallelism. Mitigation: test runs in a dedicated child process with `--no-threads`; instrumentation is via a test-only shim, not global state.
- **RISK-006**: Cross-module event payload schemas drift between producer and consumer because both modules version `events.ts` independently. Mitigation: PR rule (already in design Rule 5) — adding/changing payload fields requires `@ent-mcp/server` semver bump; reviewers cite the rule.
- **RISK-007**: Async event cycles (A emits → B emits → A emits) cause unbounded retries. Mitigation: document the runtime cycle pattern in `references/events-and-jobs.md` with a sequence diagram; require a comment at any emit site that participates in a runtime cycle.
- **RISK-008**: `ts-morph` is not in `apps/server/package.json` and adding it expands the dependency surface. Mitigation: TS compiler API path acceptable; both pre-commit script and boundaries test use the same library to avoid duplicate AST plumbing (DEP-002).
- **ASSUMPTION-001**: `fallow` 2.54.3 in this repo respects the documented first-match-wins zone membership in practice (verified via `fallow config-schema`; TASK-001 confirms on actual project files).
- **ASSUMPTION-002**: Single-handler `registerJob` semantics in the existing `jobs/` registry are stable through Phase 2; the typed wrapper's fan-out trick assumes this.
- **ASSUMPTION-003**: `apps/server/src/{index,worker}.ts` are the only process entry points. If a new entry point (e.g. CLI tool, migration runner) is added, it MUST also call `<module>.registerJobs()` — this becomes a review-time check.
- **ASSUMPTION-004**: No active feature branch concurrently rewrites a target module's layout. If overlap exists, the affected Phase 3 PR is sequenced after the feature lands.
- **ASSUMPTION-005**: The 71-import survey in Appendix A is accurate as of 2026-05-17 on `main`. Phase 1 re-runs the grep at PR-open time to catch any deltas since the design was written.

## 8. Related Specifications / Further Reading

- [docs/2026-05-17-backend-feature-architecture-design.md](../docs/2026-05-17-backend-feature-architecture-design.md) — design doc (this plan's source spec).
- [docs/2026-05-07-frontend-feature-architecture-skill-design.md](../docs/2026-05-07-frontend-feature-architecture-skill-design.md) — sibling frontend skill design (structural reference for the new backend skill).
- [docs/2026-04-20-job-service-design.md](../docs/2026-04-20-job-service-design.md) — jobs/ infrastructure design (referenced by the typed wrapper).
- [docs/2026-04-25-notifications-design.md](../docs/2026-04-25-notifications-design.md) — notifications original design (canonical exemplar).
- [docs/2026-04-27-catalog-service-design.md](../docs/2026-04-27-catalog-service-design.md) — catalog design (relevant for Phase 3 retrofit).
- [docs/2026-05-05-home-page-backend-design.md](../docs/2026-05-05-home-page-backend-design.md) — home design (relevant for Phase 3 retrofit).
- [.agents/skills/frontend-feature-architecture/SKILL.md](../.agents/skills/frontend-feature-architecture/SKILL.md) — sibling skill (mirror target).
- [Modular Monolith Primer — Kamil Grzybek](https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer) — best-practice external reference for sync via barrel + async via events.
- [Outbox Pattern — microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) — durable event reference.

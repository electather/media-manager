# Module layout

Flat layout with reserved file roles. Promote to subdirectory only when caps hit.

## Shape

```
apps/server/src/<module>/
├── index.ts          # barrel — public API, sole entry point
├── service.ts        # sync interface for other modules
├── events.ts         # event names + zod payload schemas + types
├── errors.ts         # typed error classes
├── types.ts          # public domain types
├── repo.ts           # drizzle queries on owned tables
├── jobs/             # async handlers
│   ├── index.ts      # exports registerJobs() aggregating all handlers
│   └── <handler>.ts  # one file per event; exports register<X>(): void
├── internal/         # private helpers (not exported via barrel)
│   └── <helper>.ts
└── __tests__/
    ├── service.test.ts
    └── <handler>.test.ts
```

Files exist only when the role is needed. Empty role → omit file, not empty file.

## Reserved file roles

| File | Role | May import | Forbidden |
|---|---|---|---|
| `index.ts` | Barrel. Re-exports public surface. | own files | re-exporting `repo.ts`, `internal/`, individual handler files |
| `service.ts` | Sync methods other modules call. | own `repo.ts`, `events.ts`, `types.ts`, `errors.ts`, `internal/**`, infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`, `jobs/`), shared-pkg, other modules' barrels | `drizzle-orm` and drizzle helpers (go via `repo.ts`) |
| `events.ts` | Event names + zod schemas + types. Pure. | shared-pkg, `zod` | runtime side effects, infra |
| `errors.ts` | Typed error classes. Pure. | nothing | anything beyond JS builtins |
| `types.ts` | Public domain types. Pure. | shared-pkg, own `errors.ts` | drizzle, infra |
| `repo.ts` | Drizzle queries on **owned** tables only. | `db/`, own `types.ts`, own `errors.ts`, shared-pkg | other modules' tables |
| `jobs/<x>.ts` | Async handler. Exports `register<X>(): void` calling `on(...)`. | own `service.ts`, own `repo.ts`, own `events.ts`, `jobs/events`, other modules' barrels | top-level `on(...)` calls |
| `jobs/index.ts` | Aggregates handlers. Exports single `registerJobs(): void`. | own `jobs/<x>.ts` files | anything else |
| `internal/<helper>.ts` | Private helpers. | own files, infra | being imported from outside the module |

## Barrel `index.ts` template

```ts
// <module>/index.ts
export { <Module>Service, get<Module>Service } from "./service";
export * from "./events";                   // CONST + schemas + types
export * from "./errors";                   // error classes
export type * from "./types";               // type-only
export { registerJobs } from "./jobs";      // for entry-point wiring
```

Adapters and other modules consume only what the barrel exposes.

## Promotion rules

Triggered by hitting size caps:

- `service.ts` > 500 LOC → split into `service/` directory, re-export from `service/index.ts`. One file per responsibility (`canonicalize.ts`, `enrich.ts`, `search.ts`). Never `helpers.ts`, `utils.ts`, `misc.ts`.
- `repo.ts` > 300 LOC → `repo/` directory, one file per entity.
- `internal/` is already a directory; extract more helpers as the module grows.
- Same rule for `jobs/` if a single handler file balloons (rare — handlers should be thin).

## Size and complexity budgets

| Target | Soft cap | Hard cap | Enforcement |
|---|---|---|---|
| `service.ts` LOC | 300 | 500 | `tools/check-file-sizes.ts` |
| `repo.ts` LOC | 200 | 300 | same |
| `events.ts` LOC | 150 | 200 | same |
| `jobs/<x>.ts` LOC | 150 | 200 | same |
| any function LOC | — | 50 | review (clean-code skill) |
| cyclomatic per function | — | 15 | fallow `health.maxCyclomatic` |
| cognitive per function | — | 15 | fallow `health.maxCognitive` |
| parameters per function | — | 3 | review (clean-code skill) |

## When a file does too much

Signals:

- Mixed responsibilities: `service.ts` handles HTTP retries AND business rules → extract retry policy to `internal/retry.ts`.
- Drift back to drizzle: helper functions inside `internal/` start importing drizzle → move them into `repo.ts` (or a `repo/`-subfile after promotion).
- "Generic" naming creeping in: rename to a responsibility-driven name before the next commit.

## See also

- [`service-and-repo.md`](service-and-repo.md) — sync API design.
- [`events-and-jobs.md`](events-and-jobs.md) — async API design.
- [`fallow-zones.md`](fallow-zones.md) — how the barrel/internal split is enforced.

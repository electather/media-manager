# Module layout

Flat layout w/ reserved file roles. Promote to subdir only when caps hit.

## Shape

```
apps/server/src/<module>/
├── index.ts          # barrel — public API, sole entry point
├── service.ts        # sync interface for other modules
├── events.ts         # event names + zod payload schemas + types
├── errors.ts         # typed error classes
├── types.ts          # public domain types
├── repo.ts           # drizzle queries on owned tables
├── jobs/
│   ├── index.ts      # exports registerJobs() aggregating all handlers
│   └── <handler>.ts  # one file per event; exports register<X>(): void
├── internal/
│   └── <helper>.ts
└── __tests__/
    ├── service.test.ts
    └── <handler>.test.ts
```

File exists only when role needed. Empty role → omit file, not empty file.

## Reserved file roles

| File | Role | May import | Forbidden |
|---|---|---|---|
| `index.ts` | Barrel, re-exports public surface | own files | re-exporting `repo.ts`, `internal/`, individual handler files |
| `service.ts` | Sync methods other modules call | own `repo/events/types/errors/internal/**`, infra, shared-pkg, other modules' barrels | `drizzle-orm` (go via `repo.ts`) |
| `events.ts` | Event names + zod schemas + types. Pure | shared-pkg, `zod` | runtime side effects, infra |
| `errors.ts` | Typed error classes. Pure | nothing | anything beyond JS builtins |
| `types.ts` | Public domain types. Pure | shared-pkg, own `errors.ts` | drizzle, infra |
| `repo.ts` | Drizzle queries on **owned** tables only | `db/`, own `types/errors`, shared-pkg | other modules' tables |
| `jobs/<x>.ts` | Async handler. Exports `register<X>(): void` | own `service/repo/events`, `jobs/events`, other modules' barrels | top-level `on(...)` |
| `jobs/index.ts` | Aggregates handlers → single `registerJobs(): void` | own `jobs/<x>.ts` | anything else |
| `internal/<x>.ts` | Private helpers | own files, infra | being imported from outside module |

## Barrel `index.ts` pattern

```
// <module>/index.ts
export { <Module>Service, get<Module>Service } from "./service"
export * from "./events"         // CONST + schemas + types
export * from "./errors"         // error classes
export type * from "./types"     // type-only
export { registerJobs } from "./jobs"
```

## Promotion rules

```
service.ts > 500 LOC  →  service/ dir, re-export from service/index.ts
                          one file per responsibility (never helpers/utils/misc.ts)
repo.ts > 300 LOC     →  repo/ dir, one file per entity
internal/              already a dir; extract more helpers as module grows
jobs/<x>.ts ballooned  →  same rule (rare — handlers should be thin)
```

## Size and complexity budgets

| Target | Soft cap | Hard cap | Enforcement |
|---|---|---|---|
| `service.ts` LOC | 300 | 500 | `tools/check-file-sizes.ts` |
| `repo.ts` LOC | 200 | 300 | same |
| `events.ts` LOC | 150 | 200 | same |
| `jobs/<x>.ts` LOC | 150 | 200 | same |
| any function LOC | — | 50 | review (`clean-code` skill) |
| cyclomatic/fn | — | 15 | fallow `health.maxCyclomatic` |
| cognitive/fn | — | 15 | fallow `health.maxCognitive` |
| params/fn | — | 3 | review (`clean-code` skill) |

## When file does too much

```
mixed responsibilities:
  service.ts handles HTTP retries AND business rules
  → extract retry policy to internal/retry.ts

drizzle drift in internal/:
  helpers inside internal/ start importing drizzle
  → move to repo.ts (or repo/<x>.ts after promotion)

generic naming creeping in:
  → rename to responsibility-driven name before next commit
```

## See also

- [service-and-repo.md](service-and-repo.md) — sync API design
- [events-and-jobs.md](events-and-jobs.md) — async API design
- [fallow-zones.md](fallow-zones.md) — barrel/internal split enforcement

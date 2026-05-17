# DB ownership

Each drizzle table has exactly one owning module. Others read/write through owner's barrel — never direct drizzle queries against another module's tables.

## Why

Barrel without DB ownership = decorative. Modules still share state via DB, defeating boundary. Owned tables → refactors surgical — owner reshapes storage without rippling to consumers.

## `@owner:` directive

Every drizzle schema file under `apps/server/src/db/schema/**/*.ts` declares owner:

```
// db/schema/catalog.ts
// @owner: catalog

table canonical_media { id: pk, title: notNull, ... }
table catalog_features { ... }
```

Rules:
- One `@owner:` at file top → owns every table in file
- Multi-owner files → split before annotating. One owner per file
- Mixed-owner (rare): `// @owner(tableName): <module>` per export. Script prefers per-table over file-level
- Junction tables: assign to module with stronger ownership of lifecycle. Document in comment

## Enforcement

`tools/check-table-ownership.ts`:

```
1. walk db/schema/**/*.ts → read @owner: → build {exportName → owningModule}
2. walk server/src/<module>/**/*.ts (excl. api/, mcp/, tests)
3. per named import resolving to db/schema/*: assert import.owner === importingModule
4. exception: import is in <module>/repo.ts or <module>/repo/**
5. resolve TS path aliases via tsconfig paths
6. exit 1 on violations → wired into vp staged + CI
```

## Reading another module's data

```
// home wants catalog data
import { getCatalogService } from "../../catalog"       // barrel — correct
item = await getCatalogService().getCanonical(id)

// NEVER:
import { canonicalMedia } from "../../db/schema/catalog"  // blocked by check-table-ownership
```

If owner barrel lacks needed method → add to owner's `service.ts`, re-export via barrel, call it.

## Writing another module's data

Same answer. Add method to owner's `service.ts` (incl. business rules, validation, emit). Consumers call method.

Consumer needs write in own transaction → design smell: data likely belongs to consumer's module, or use events to avoid cross-mod transactions.

## Adding a new table

```
1. decide owner (usually obvious from what table represents)
2. create/extend db/schema/<owner>.ts, annotate // @owner: <owner> if new file
3. vp run db:generate
4. add repo.ts queries
5. expose service methods if other modules need to interact
```

## Renaming / moving a table

```
1. migration moves/renames table
2. update schema file @owner: if ownership shifts
3. run check-table-ownership.ts → orphaned cross-mod imports surface
4. move queries to new owner's repo.ts
```

## Phase 4 (future): namespace split

Follow-up spec moves to per-module schema namespaces: `db/schema/<module>/*.ts`. Fallow rules tighten so each `repo.ts` imports only from own namespace. Until then: `@owner:` + pre-commit script = boundary.

## See also

- [service-and-repo.md](service-and-repo.md) — repo.ts structure
- [fallow-zones.md](fallow-zones.md) — boundary enforcement for code (parallel to ownership for data)

# DB ownership

Each drizzle table has exactly one owning module. Other modules read and write through the owner's barrel — never directly via drizzle queries against another module's tables.

## Why

A barrel without DB ownership is decorative: modules can still share state through the database, defeating the boundary. Owning tables means refactors stay surgical — the owner can reshape its storage without rippling through consumers.

## `@owner:` directive

Every drizzle schema file under `apps/server/src/db/schema/**/*.ts` declares its owner:

```ts
// apps/server/src/db/schema/catalog.ts
// @owner: catalog

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const canonicalMedia = sqliteTable("canonical_media", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  // ...
});

export const catalogFeatures = sqliteTable("catalog_features", {
  // ...
});
```

Rules:

- One `@owner:` directive at file top → owns every table declared in the file.
- Multi-owner files are split before annotating. One owner per file.
- For a file that legitimately mixes owners (rare), use per-export directives: `// @owner(tableName): <module>` next to each table declaration. The script prefers explicit per-table directives over the file-level one.
- Junction tables connecting two modules' entities: assign to the module that has the stronger ownership of the relationship's lifecycle. Document the choice in a comment.

## Enforcement

`tools/check-table-ownership.ts`:

1. Walks `apps/server/src/db/schema/**/*.ts`. Reads `@owner:` directives. Builds `tableExportName → owningModule` map.
2. Walks `apps/server/src/<module>/**/*.ts` (excluding `api/`, `mcp/`, adapters, tests).
3. For every named import resolving to `apps/server/src/db/schema/*`, asserts the imported identifier's owner matches the importing module's directory.
4. Allowed exception: the import is in `<module>/repo.ts` or `<module>/repo/**`.
5. TS path aliases resolved via `tsconfig.json` `paths`.
6. Exit 1 on violations. Wired into `vp staged` and CI.

## Reading another module's data

If your module needs data owned by another module:

1. Check the owner's barrel — there's probably a method already.
2. If not, add a method to the owner's `service.ts` and re-export it via the owner's barrel.
3. Call it.

```ts
// home/internal/orchestrator.ts — wants catalog data
import { getCatalogService } from "../../catalog";

const catalog = getCatalogService();
const item = await catalog.getCanonical(id);   // correct

// ❌ never:
// import { canonicalMedia } from "../../db/schema/catalog";   // blocked by check-table-ownership.ts
```

## Writing another module's data

Same answer. Add a method to the owner's `service.ts` that performs the write — including any business rules, validation, and event emission. Consumers call the method.

If the consumer needs the write to participate in its own transaction, that's a design smell: the data probably belongs to your module, or the two modules should communicate through events to avoid cross-module transactions.

## Adding a new table

1. Decide the owner. Usually obvious from what the table represents.
2. Create or extend the appropriate schema file under `apps/server/src/db/schema/<owner>.ts`. Annotate with `// @owner: <owner>` if the file is new.
3. Generate the migration with `vp run db:generate` (or per project conventions).
4. Add `repo.ts` queries on the new table.
5. Expose service methods if other modules will need to interact with the data.

## Renaming or moving a table

1. Migration moves the table (or renames it).
2. Update the schema file's `@owner:` directive if ownership shifts.
3. Run `tools/check-table-ownership.ts` — any orphaned cross-module imports surface here.
4. Move queries to the new owner's `repo.ts`.

## Phase 4 (future): namespace split

A follow-up spec moves to per-module schema namespaces: `db/schema/<module>/*.ts`. At that point fallow rules tighten so each module's `repo.ts` may only import from its own namespace. Until then, the `@owner:` convention + the pre-commit script is the boundary.

## See also

- [`service-and-repo.md`](service-and-repo.md) — how `repo.ts` is structured.
- [`fallow-zones.md`](fallow-zones.md) — boundary enforcement for code (parallel to ownership enforcement for data).

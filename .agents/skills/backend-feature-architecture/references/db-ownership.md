# DB ownership

Each drizzle table has exactly one owning module. Others read/write through owner's barrel — never direct drizzle queries against another module's tables.

## Why

Barrel without DB ownership = decorative. Modules still share state via DB, defeating boundary. Owned tables → refactors surgical — owner reshapes storage without rippling to consumers.

## Per-module schema namespaces

Every drizzle table lives under `apps/server/src/db/schema/<module>/` — the directory IS the owner.

```
apps/server/src/db/schema/
├── auth/{auth,users,roles}.ts          # auth module
├── catalog/{catalog,id-map}.ts         # catalog
├── home/home.ts
├── infra/{jobs,diagnostics}.ts         # server-infra (shared across modules)
├── notifications/notifications.ts
├── plugin-runtime/{plugins,credentials,plugin-shared-credentials}.ts
├── preferences/{preferences,user-preferences,feedback}.ts
└── watchlist/watchlist.ts
```

Each subdirectory has an `index.ts` barrel. The root `index.ts` re-exports every subdirectory barrel — drizzle's schema entry point is unchanged.

## Enforcement

Each subdirectory is a fallow zone:

- `server-schema-auth` covers `db/schema/auth/**`
- `server-schema-catalog` covers `db/schema/catalog/**`
- ... one zone per module
- `server-schema-infra` covers `db/schema/infra/**` and `db/schema/index.ts` (the root barrel)

Per-module fallow allow rules let `server-mod-<module>-internal` reach `server-schema-<module>` and `server-schema-infra` — nothing else. A module trying to import from another module's schema namespace fails `fallow dead-code` with a boundary violation.

## Reading another module's data

```
// home wants catalog data
import { getCatalogService } from "../../catalog"       // barrel — correct
item = await getCatalogService().getCanonical(id)

// NEVER:
import { canonicalMedia } from "../../db/schema/catalog"  // blocked by server-schema-catalog zone
```

If owner barrel lacks needed method → add to owner's `service.ts`, re-export via barrel, call it.

## Writing another module's data

Same answer. Add method to owner's `service.ts` (incl. business rules, validation, emit). Consumers call method.

Consumer needs write in own transaction → design smell: data likely belongs to consumer's module, or use events to avoid cross-mod transactions.

## Adding a new table

```
1. decide owner (usually obvious from what table represents)
2. create file at db/schema/<owner>/<file>.ts and re-export it from db/schema/<owner>/index.ts
3. vp run db:generate
4. add repo.ts queries
5. expose service methods if other modules need to interact
```

## Renaming / moving a table

```
1. migration moves/renames table
2. move schema file to new owner's subdirectory; update the old owner's index.ts to stop re-exporting it
3. run `vp dlx fallow dead-code` → orphaned cross-mod imports surface as boundary violations
4. move queries to new owner's repo.ts
```

## Cross-module crossings (last resort)

A cross-module schema import is a one-way ratchet. If you genuinely must read another module's table without going through its barrel:

```ts
// TASK-<n>: <consumer> reads <table> via <owner> barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { otherTable } from "../../db/schema/<other-module>/<file>";
```

The directive requires:
- A paired plan task ID in the comment (so the crossing has an owner and a destination).
- The import points at the OWNER's namespace, not the root `db/schema` barrel — the import site stays grep-able and the boundary check stays meaningful.

## See also

- [service-and-repo.md](service-and-repo.md) — repo.ts structure
- [fallow-zones.md](fallow-zones.md) — boundary enforcement for code (parallel to ownership for data)
- [`docs/2026-05-20-backend-schema-namespaces-design.md`](../../../../docs/2026-05-20-backend-schema-namespaces-design.md) — design rationale

# Service & repo contract

Sync API contract between modules. Two layers: `service.ts` (public, called by other modules) + `repo.ts` (private, owns drizzle access).

## Service: public sync surface

```
// catalog/service.ts
class CatalogService(repo: CatalogRepo):
  getCanonical(id) → CanonicalMedia:
    row = repo.findCanonicalById(id)
    if !row: throw CatalogNotFoundError(id)
    return row

  search(query) → CanonicalMedia[]:
    return repo.searchCanonical(query)

singleton: getCatalogService() → new CatalogService(repo) on first call
```

Rules:
- Methods named for what they do, not how (`getCanonical` not `fetchFromDb`)
- Throws typed errors from `errors.ts`. No string-message `Error` instances
- Takes plain data, returns plain data. Never return drizzle rows directly (map in `repo.ts`)
- No `drizzle-orm` imports. Only `repo.ts` touches drizzle
- Singleton factory accessor fine; explicit DI also fine. Don't expose constructor via barrel without reason

## Repo: private data layer

```
// catalog/repo.ts
import { db } from "../db"
import { canonicalMedia } from "../db/schema/catalog"  // @owner: catalog
import { eq, ilike } from "drizzle-orm"

class CatalogRepo:
  findCanonicalById(id) → CanonicalMedia | null:
    [row] = db.select().from(canonicalMedia).where(eq(id))
    return row ? toCanonical(row) : null

  searchCanonical(query) → CanonicalMedia[]:
    rows = db.select().from(canonicalMedia).where(ilike(title, `%${query}%`))
    return rows.map(toCanonical)

  private toCanonical(row) → CanonicalMedia: { id, title, ... }
```

Rules:
- Sole place `drizzle-orm` imported in module
- Imports tables only from `db/schema/<this-module>` or unmarked schema files — never another module's tables
- Maps drizzle rows to module's public types. Don't leak `$inferSelect` shapes outside `repo.ts`
- Async-only. No sync drizzle calls
- One class per module fine; promote to `repo/` dir for larger modules (one file per entity)

## How another module consumes you

```
// home/internal/orchestrator.ts
import { getCatalogService } from "../../catalog"      // barrel — required
import { getMediaService, AllPluginsFailedError } from "../../media"

composeRow(...):
  canonical = await getCatalogService().getCanonical(id)
  dispatch  = await getMediaService().dispatch(canonical)
  return { canonical, dispatch }
  catch AllPluginsFailedError: return { canonical, dispatch: null }
```

Forbidden:
```
import { CatalogRepo } from "../../catalog/repo"                    // deep import — fallow rejects
import { canonicalMedia } from "../../db/schema/catalog"            // only OK inside catalog/repo.ts
import { toCanonicalRow } from "../../catalog/canonical"            // internal — use service method
```

## When to add new method to `service.ts`

```
consumer reaches into internals for data     → add sync method to service
consumer needs side-effect (notify/index)    → emit event instead (events-and-jobs.md)
```

## Error design

```
// catalog/errors.ts
class CatalogError(msg, code): extends Error
  name = "CatalogError"

class CatalogNotFoundError(id): extends CatalogError
  super(`Catalog item not found: ${id}`, "CATALOG_NOT_FOUND")
  name = "CatalogNotFoundError"
```

Rules:
- One base error per module: `<Module>Error`. Specific subclasses extend it
- Carry structured fields (`code`, ids, http status hints) so adapters map without parsing message
- Never expose internal stack details (DB/drizzle errors) to consumers — wrap them
- Code severity (`packages/shared/src/diagnostics/codes.ts`) must match intent: expected user-state failures (no plugin connected, bad credentials, token expired) → `info`; recovered degraded path → `warning`; genuine fault → `error`
- `info`-severity codes → ⊥ trigger notification ∧ ⊥ captureError. `errorHandler` uses registry automatically (§PluginErr in diagnostics design); no callsite annotation needed
- Service methods that swallow expected plugin absence (no connection → empty result) → catch typed error at service boundary, ⊥ let it propagate to HTTP boundary naked

## Tests

```
// catalog/__tests__/service.test.ts
import { vi } from "vite-plus/test"

repo = { findCanonicalById: vi.fn(), searchCanonical: vi.fn() }

test "getCanonical returns row when present"
test "getCanonical throws CatalogNotFoundError when missing"
```

Mock `repo.ts`, not drizzle. Mock other modules' barrels, not internals.

## See also

- [module-layout.md](module-layout.md) — file shape
- [events-and-jobs.md](events-and-jobs.md) — when to emit instead of adding sync method
- [db-ownership.md](db-ownership.md) — table ownership rules

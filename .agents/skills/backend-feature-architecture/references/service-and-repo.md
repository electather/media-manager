# Service & repo contract

The sync API contract between modules. Two layers per module: `service.ts` (public, called by other modules) and `repo.ts` (private, owns drizzle access).

## Service: the public sync surface

```ts
// catalog/service.ts
import type { CatalogRepo } from "./repo";
import type { CanonicalMedia } from "./types";
import { CatalogNotFoundError } from "./errors";

export class CatalogService {
  constructor(private repo: CatalogRepo) {}

  async getCanonical(id: string): Promise<CanonicalMedia> {
    const row = await this.repo.findCanonicalById(id);
    if (!row) throw new CatalogNotFoundError(id);
    return row;
  }

  async search(query: string): Promise<CanonicalMedia[]> {
    return this.repo.searchCanonical(query);
  }
}

let instance: CatalogService | null = null;
export function getCatalogService(): CatalogService {
  if (!instance) instance = new CatalogService(/* injected repo */);
  return instance;
}
```

Rules:

- Methods named for what they do, not how (`getCanonical`, not `fetchFromDb`).
- Throws typed errors from `errors.ts`. No string-message `Error` instances.
- Takes plain data, returns plain data. Never returns drizzle rows directly (map in `repo.ts`).
- No direct `drizzle-orm` imports here. Only `repo.ts` touches drizzle.
- Singleton-style factory accessor is fine; explicit DI also fine. Don't expose the class constructor as part of the barrel unless you have a reason.

## Repo: the private data layer

```ts
// catalog/repo.ts
import { db } from "../db";
import { canonicalMedia } from "../db/schema/catalog";  // @owner: catalog
import { eq, ilike } from "drizzle-orm";
import type { CanonicalMedia } from "./types";

export class CatalogRepo {
  async findCanonicalById(id: string): Promise<CanonicalMedia | null> {
    const [row] = await db.select().from(canonicalMedia).where(eq(canonicalMedia.id, id));
    return row ? this.toCanonical(row) : null;
  }

  async searchCanonical(query: string): Promise<CanonicalMedia[]> {
    const rows = await db.select().from(canonicalMedia).where(ilike(canonicalMedia.title, `%${query}%`));
    return rows.map(this.toCanonical);
  }

  private toCanonical(row: typeof canonicalMedia.$inferSelect): CanonicalMedia {
    return { id: row.id, title: row.title /* ... */ };
  }
}
```

Rules:

- Sole place `import { ... } from "drizzle-orm"` appears in the module.
- Imports tables only from `db/schema/<this-module>` or unmarked schema files — never tables owned by another module.
- Maps drizzle row shapes to the module's public types. Don't leak `$inferSelect` shapes outside `repo.ts`.
- Async-only. No sync drizzle calls.
- One class per module is fine; for larger modules, promote to `repo/` directory with one file per entity.

## How another module consumes you

```ts
// home/internal/orchestrator.ts (not orchestrator at module root — that's the public service or internal helper)
import { getCatalogService } from "../../catalog";          // barrel — required
import { getMediaService, AllPluginsFailedError } from "../../media";

async function composeRow(/* ... */) {
  const catalog = getCatalogService();
  const media = getMediaService();
  try {
    const canonical = await catalog.getCanonical(id);
    const dispatch = await media.dispatch(canonical);
    return { canonical, dispatch };
  } catch (err) {
    if (err instanceof AllPluginsFailedError) {
      return { canonical, dispatch: null };
    }
    throw err;
  }
}
```

Forbidden patterns:

```ts
// ❌ deep import — fallow rejects
import { CatalogRepo } from "../../catalog/repo";

// ❌ raw drizzle from outside repo
import { canonicalMedia } from "../../db/schema/catalog";   // OK only inside catalog/repo.ts

// ❌ reaching past barrel for an internal helper
import { toCanonicalRow } from "../../catalog/canonical";   // belongs in catalog/internal or behind a service method
```

## When to add a new method to `service.ts`

- A consumer needs data and currently does the work itself by reaching into your internals → add the method.
- A consumer needs a side-effect (notify, index, refresh) → don't add a sync method, emit an event. See [`events-and-jobs.md`](events-and-jobs.md).

## Error design

```ts
// catalog/errors.ts
export class CatalogError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "CatalogError";
  }
}
export class CatalogNotFoundError extends CatalogError {
  constructor(public id: string) {
    super(`Catalog item not found: ${id}`, "CATALOG_NOT_FOUND");
    this.name = "CatalogNotFoundError";
  }
}
```

Rules:

- One base error per module, named `<Module>Error`. Specific subclasses extend it.
- Carry structured fields (`code`, ids, http status hints) so adapters can map without parsing the message.
- Never expose internal stack details (DB errors, drizzle errors) to consumers — wrap them.

## Tests

```ts
// catalog/__tests__/service.test.ts
import { describe, it, expect, vi } from "vite-plus/test";
import { CatalogService } from "../service";
import type { CatalogRepo } from "../repo";

const repo = { findCanonicalById: vi.fn(), searchCanonical: vi.fn() } satisfies Partial<CatalogRepo>;

describe("CatalogService.getCanonical", () => {
  it("returns the row when present", async () => { /* ... */ });
  it("throws CatalogNotFoundError when missing", async () => { /* ... */ });
});
```

Mock `repo.ts`, not drizzle. Mock other modules' barrels, not their internals.

## See also

- [`module-layout.md`](module-layout.md) — file shape.
- [`events-and-jobs.md`](events-and-jobs.md) — when to emit instead of adding a sync method.
- [`db-ownership.md`](db-ownership.md) — table ownership rules.

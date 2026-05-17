# Example: new module `watchlist`

End-to-end scaffold. Cite SKILL.md rules.

## 0. Decide

- Domain? Yes → module. Infra/adapter? Skip skill.
- Owns tables? Yes → `repo.ts` + schema `@owner`.
- Emits events? Maybe → `events.ts`.

## 1. Scaffold

```
apps/server/src/watchlist/
├── index.ts
├── service.ts
├── events.ts          # if emitting
├── errors.ts
├── types.ts
├── repo.ts            # if DB
├── jobs/
│   ├── index.ts
│   └── on-<src>-<evt>.ts   # if handling cross-mod events
├── internal/
└── __tests__/
```

## 2. Schema + owner (R3)

```ts
// db/schema/watchlist.ts
// @owner: watchlist
export const watchlistItem = sqliteTable("watchlist_item", { /* ... */ });
```

## 3. repo.ts (R2)

```ts
// watchlist/repo.ts
import { db } from "../db";
import { watchlistItem } from "../db/schema/watchlist";
import { eq } from "drizzle-orm";
import type { WatchlistItem } from "./types";

export class WatchlistRepo {
  async add(userId: string, mediaId: string): Promise<WatchlistItem> { /* ... */ }
  async listByUser(userId: string): Promise<WatchlistItem[]> { /* ... */ }
}
```

Drizzle imports ONLY here.

## 4. events.ts (R12)

```ts
// watchlist/events.ts
import { z } from "zod";

export const WATCHLIST_EVENTS = {
  ITEM_ADDED: "watchlist.item.added",
} as const;

export const itemAddedPayload = z.object({
  userId: z.string(),
  mediaId: z.string(),
  occurredAt: z.string().datetime(),
});
export type ItemAddedPayload = z.infer<typeof itemAddedPayload>;
```

## 5. service.ts (R1, R2)

```ts
// watchlist/service.ts
import { emit } from "../jobs/events";
import { WatchlistRepo } from "./repo";
import { WATCHLIST_EVENTS, itemAddedPayload } from "./events";
import type { WatchlistItem } from "./types";

export class WatchlistService {
  constructor(private repo: WatchlistRepo) {}

  async add(userId: string, mediaId: string): Promise<WatchlistItem> {
    const item = await this.repo.add(userId, mediaId);
    await emit(WATCHLIST_EVENTS.ITEM_ADDED, itemAddedPayload, {
      userId, mediaId, occurredAt: item.createdAt.toISOString(),
    });
    return item;
  }
}

let inst: WatchlistService | null = null;
export const getWatchlistService = () => (inst ??= new WatchlistService(new WatchlistRepo()));
```

## 6. jobs/ (R7)

If subscribing to cross-mod event:

```ts
// watchlist/jobs/on-catalog-media-removed.ts
import { on } from "../../jobs/events";
import { CATALOG_EVENTS, mediaRemovedPayload } from "../../catalog";   // barrel only
import { getWatchlistService } from "..";

export function registerOnCatalogMediaRemoved(): void {
  on(CATALOG_EVENTS.MEDIA_REMOVED, mediaRemovedPayload, async (p) => {
    await getWatchlistService().pruneByMedia(p.mediaId);
  });
}
```

```ts
// watchlist/jobs/index.ts
import { registerOnCatalogMediaRemoved } from "./on-catalog-media-removed";
export function registerJobs(): void {
  registerOnCatalogMediaRemoved();
}
```

No top-level `on(...)`.

## 7. errors.ts

```ts
// watchlist/errors.ts
export class WatchlistError extends Error { /* ... */ }
export class WatchlistDuplicateError extends WatchlistError { /* ... */ }
```

## 8. types.ts

```ts
// watchlist/types.ts
export interface WatchlistItem {
  id: string;
  userId: string;
  mediaId: string;
  createdAt: Date;
}
```

## 9. index.ts (barrel, R1, R10)

```ts
// watchlist/index.ts
export { WatchlistService, getWatchlistService } from "./service";
export * from "./events";
export * from "./errors";
export type * from "./types";
export { registerJobs } from "./jobs";
```

NO re-exports `repo`, `internal`, `jobs/<x>`.

## 10. Tests

```ts
// watchlist/__tests__/service.test.ts
import { describe, it, expect, vi } from "vite-plus/test";
import { WatchlistService } from "../service";

const repo = { add: vi.fn(), listByUser: vi.fn() };
// mock repo, NOT drizzle.
```

## 11. fallow zones

`.fallowrc.json` += 2 zones, narrow first:

```jsonc
{ "name": "server-mod-watchlist",          "patterns": ["apps/server/src/watchlist/index.ts"] },
{ "name": "server-mod-watchlist-internal", "patterns": ["apps/server/src/watchlist/**"] }
```

+ 2 rules (allow infra + other mod barrels + shared-pkg + plugin-sdk).

+ update consumer modules' allow lists if they import watchlist.

## 12. Wire boot (alphabetical, R7)

```ts
// apps/server/src/index.ts + worker.ts
import * as watchlist from "./watchlist";
// ...alphabetical insertion: after preferences, before? — "w" last.
watchlist.registerJobs();
```

## 13. Changeset

```md
---
"@ent-mcp/server": minor
---

Added watchlist module.
```

## 14. Verify

```bash
vp check && vp test
fallow dead-code --format json --quiet 2>/dev/null | jq '.boundary_violations'   # []
node tools/check-table-ownership.ts
node tools/check-file-sizes.ts
```

All green → ship.

## See

- [`module-layout.md`](../module-layout.md)
- [`service-and-repo.md`](../service-and-repo.md)
- [`events-and-jobs.md`](../events-and-jobs.md)
- [`fallow-zones.md`](../fallow-zones.md)

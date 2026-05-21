# Example: new module `watchlist`

End-to-end scaffold. Cite SKILL.md rules.

## 0. Decide

```
domain?       yes → module. infra/adapter? → skip skill
owns tables?  yes → repo.ts + schema files under db/schema/<module>/
emits events? maybe → events.ts
```

## 1. Scaffold

```
apps/server/src/watchlist/
├── index.ts
├── service.ts
├── events.ts          (if emitting)
├── errors.ts
├── types.ts
├── repo.ts            (if DB)
├── jobs/
│   ├── index.ts
│   └── on-<src>-<evt>.ts   (if handling cross-mod events)
├── internal/
└── __tests__/
```

## 2. Schema + owner (R3)

```
// db/schema/watchlist/watchlist.ts
table watchlist_item { ... }

// db/schema/watchlist/index.ts
export * from "./watchlist";
```

## 3. repo.ts (R2)

```
// watchlist/repo.ts
import { db, watchlistItem, eq } from drizzle

class WatchlistRepo:
  add(userId, mediaId) → WatchlistItem
  listByUser(userId) → WatchlistItem[]
```

Drizzle imports ONLY here.

## 4. events.ts (R12)

```
// watchlist/events.ts
WATCHLIST_EVENTS = { ITEM_ADDED: "watchlist.item.added" } as const
schema itemAdded = { userId: str, mediaId: str, occurredAt: datetime }
type ItemAddedPayload = infer<itemAdded>
```

## 5. service.ts (R1, R2)

```
// watchlist/service.ts
class WatchlistService(repo):
  add(userId, mediaId) → WatchlistItem:
    item = await repo.add(userId, mediaId)
    await emit(WATCHLIST_EVENTS.ITEM_ADDED, itemAddedPayload, { userId, mediaId, occurredAt })
    return item

singleton: getWatchlistService() → inst ??= new WatchlistService(new WatchlistRepo())
```

## 6. jobs/ (R7)

```
// watchlist/jobs/on-catalog-media-removed.ts
export fn registerOnCatalogMediaRemoved():
  on(CATALOG_EVENTS.MEDIA_REMOVED, mediaRemovedPayload, async p =>
    getWatchlistService().pruneByMedia(p.mediaId)
  )
  // import CATALOG_EVENTS from "../../catalog" (barrel only)

// watchlist/jobs/index.ts
export fn registerJobs(): registerOnCatalogMediaRemoved()
```

No top-level `on(...)`.

## 7. errors.ts

```
class WatchlistError extends Error
class WatchlistDuplicateError extends WatchlistError
```

## 8. types.ts

```
interface WatchlistItem { id, userId, mediaId, createdAt: Date }
```

## 9. index.ts barrel (R1, R10)

```
// watchlist/index.ts
export { WatchlistService, getWatchlistService } from "./service"
export * from "./events"
export * from "./errors"
export type * from "./types"
export { registerJobs } from "./jobs"
// NO: repo, internal, jobs/<x>
```

## 10. Tests

```
// watchlist/__tests__/service.test.ts
repo = { add: vi.fn(), listByUser: vi.fn() }
// mock repo, NOT drizzle
```

## 11. Fallow zones

```
// .fallowrc.json (narrow first)
{ name: "server-mod-watchlist",          patterns: ["apps/server/src/watchlist/index.ts"] }
{ name: "server-mod-watchlist-internal", patterns: ["apps/server/src/watchlist/**"] }

+ 2 rules: allow [infra, other-mod-barrels, shared-pkg, plugin-sdk]
+ update consumer modules' allow lists if they import watchlist
```

## 12. Wire boot (alphabetical, R7)

```
// index.ts + worker.ts
import * as watchlist from "./watchlist"
// "w" → last alphabetically
watchlist.registerJobs()
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
fallow dead-code --format json --quiet 2>/dev/null | jq '.boundary_violations'  # []
node tools/check-file-sizes.ts
```

## See also

- [../module-layout.md](../module-layout.md)
- [../service-and-repo.md](../service-and-repo.md)
- [../events-and-jobs.md](../events-and-jobs.md)
- [../fallow-zones.md](../fallow-zones.md)

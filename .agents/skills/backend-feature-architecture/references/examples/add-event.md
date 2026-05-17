# Example: add cross-module event

Scenario: `catalog` adds media → `notifications` notify user + `home` invalidate row cache.

## 1. Producer declares (R12)

```
// catalog/events.ts
CATALOG_EVENTS = { MEDIA_ADDED: "catalog.media.added" } as const  // <module>.<entity>.<verb-past>

schema mediaAdded = { mediaId: str, userId: str, occurredAt: datetime }
type MediaAddedPayload = infer<mediaAdded>
```

Barrel re-exports `events.ts` → consumers `import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog"`.

## 2. Producer emits

```
// catalog/service.ts
import { emit } from "../jobs/events"
import { CATALOG_EVENTS, mediaAddedPayload } from "./events"

addMedia(input):
  row = await repo.insert(input)
  await emit(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, { mediaId: row.id, userId, occurredAt })
  return row
```

zod validates @ `emit` → throws sync → tx rollback if wrapped.

## 3. Consumer A: notifications

```
// notifications/jobs/on-catalog-media-added.ts
import { on } from "../../jobs/events"
import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog"  // BARREL — never ../../catalog/events
import { getNotificationsService } from ".."

export fn registerOnCatalogMediaAdded():
  on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async p =>
    getNotificationsService().notifyMediaAdded(p)
  )

// notifications/jobs/index.ts
export fn registerJobs(): registerOnCatalogMediaAdded(); ...
```

## 4. Consumer B: home (fan-out, R7)

```
// home/jobs/on-catalog-media-added.ts
export fn registerOnCatalogMediaAdded():
  on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async p =>
    getHomeService().invalidateRowsFor(p.userId)
  )
```

Both `on(...)` same event → fan-out sequential in registration order. First throw → runner retries whole event. Handlers MUST be idempotent.

## 5. Boot wires it

```
// index.ts + worker.ts (alphabetical)
catalog.registerJobs()       // no-op for emit-only side
home.registerJobs()
notifications.registerJobs()
```

`boot.test.ts`: ≥1 `on(...)` per declared event.

## 6. Test producer

```
// catalog/__tests__/service.test.ts
emit = vi.spyOn(jobsEvents, "emit")
await svc.addMedia({...})
expect(emit).toHaveBeenCalledWith("catalog.media.added", anything, { mediaId: "..." })
```

## 7. Test consumer

```
// notifications/__tests__/on-catalog-media-added.test.ts
svc = { notifyMediaAdded: vi.fn() }
await handlerFn({ mediaId: "x", userId: "u", occurredAt: "..." })  // call handler directly, bypass on()
expect(svc.notifyMediaAdded).toHaveBeenCalled()
```

## 8. Changeset (R5)

```md
---
"@ent-mcp/server": minor
---

catalog emits media.added; home + notifications react.
```

## 9. Changing event later

```
add field         →  minor, optional or default value
rename/require/retype  →  minor + check all consumers + update test fixtures
remove field      →  minor + check all consumers
rename event      →  soft-deprecate: emit both for one release, migrate, remove old
```

## 10. Anti-patterns

```
import { CATALOG_EVENTS } from "../../catalog/events"    // deep import producer events
on("catalog.media.added", schema, handler)               // string literal not constant (R12)
on(CATALOG_EVENTS.MEDIA_ADDED, ...)                      // top-level on() call (R7)
import { registerJob } from "../../jobs"                 // bypass zod + fan-out
await getNotificationsService().notify(...)              // sync call in catalog.service.ts — coupling
```

## See also

- [../events-and-jobs.md](../events-and-jobs.md)
- [../service-and-repo.md](../service-and-repo.md) — sync alternative

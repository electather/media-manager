# Events & jobs

Async API contract between modules. Sync via service ([service-and-repo.md](service-and-repo.md)); fire-and-forget via events serialized as jobs.

## When to emit

```
caller needs result           →  sync (service call)
caller signals "happened"     →  async (event)

test: remove call → return unchanged but side-effect missing? → event
```

Examples:
- catalog added canonical row → notify, reindex, warm cache. **Event.**
- home composes row needing catalog data. **Sync** (`catalog.getCanonical(...)`)
- media dispatch succeeded → analytics. **Event** for analytics; sync for dispatch itself

## Declaring an event

```
// catalog/events.ts
CATALOG_EVENTS = {
  MEDIA_ADDED:   "catalog.media.added",
  MEDIA_REMOVED: "catalog.media.removed",
} as const

schema mediaAdded   = { mediaId: str, userId: str, occurredAt: datetime }
schema mediaRemoved = { mediaId: str, removedBy: str }
type MediaAddedPayload = infer<mediaAdded>
```

Rules:
- Name format: `<module>.<entity>.<verb-past>`. Lower-kebab
- One `<MODULE>_EVENTS` const per module. Others ref constant, never string literal
- Payloads = zod schemas + derived types
- `events.ts` pure: no side effects, no runtime imports beyond `zod`
- Add field → minor changeset. Change type/required → minor + migration note. Remove field → minor + check consumers

## Emitting

```
// catalog/service.ts
import { emit } from "../jobs/events"
import { CATALOG_EVENTS, mediaAddedPayload } from "./events"

async addMedia(input):
  row = await repo.insertCanonical(input)
  await emit(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, { mediaId: row.id, userId, occurredAt })
  return row
```

Rules:
- Use `emit(name, schema, payload)` from `jobs/events`. Not raw `enqueue`
- `emit` validates payload via zod sync before enqueue. Fail → throw → tx rollback
- If repo write is transactional: `await emit(...)` AFTER tx commits. No uncommitted state in queue

## Consuming

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
export fn registerJobs():
  registerOnCatalogMediaAdded()
  // ...

// notifications/index.ts
export { registerJobs } from "./jobs"
```

Rules:
- Each handler file exports `register<X>(): void`. No top-level `on(...)`
- Handler filename matches event: `on-<source>-<entity>-<verb>.ts`
- Import event const + schema from producer's **barrel**. Never deep-import `<producer>/events`
- Handlers idempotent. Runner retries on throw

## Boot order

Two-stage. No top-level side effects.

```
Stage A: index.ts + worker.ts call registerJobs() for all modules, alphabetical:
  artwork.registerJobs()
  auth.registerJobs()
  catalog.registerJobs()
  home.registerJobs()
  media.registerJobs()
  notifications.registerJobs()
  preferences.registerJobs()
  pluginRuntime.registerJobs()

Stage B: job runner starts polling. Web routes accept requests.
```

`boot.test.ts` enforces:
- Alphabetical order (fan-out sequential → order matters)
- Every declared event has ≥1 `on(...)` registration post Stage A

## Fan-out

Multiple modules subscribe to same event:

```
notifications/jobs/on-catalog-media-added.ts:
  on(CATALOG_EVENTS.MEDIA_ADDED, schema, notifyHandler)

home/jobs/on-catalog-media-added.ts:
  on(CATALOG_EVENTS.MEDIA_ADDED, schema, refreshLayoutHandler)
```

Both run in registration order (sequential). One throw → rethrow → runner retries whole event. Handlers MUST be idempotent.

Parallel variant (independent handlers, one fail doesn't poison rest): not yet shipped — TODO.

## Runtime cycles

Static import cycles (`A→B→A`) forbidden. Fallow `circular-deps: error` on `server-mod-*`.

Runtime event cycles (`A emits → B handles → B emits → A handles`) allowed with care:
- Document cycle in sequence diagram in producer's `events.ts` header comment
- Each leg must converge (loop terminates when state stabilises)
- Add max-depth guard or dedup key in payload if cycle could fire repeatedly on same entity

## Scheduled work (in-module, no public contract)

```
// notifications/jobs/stale-pending-sweep.ts
export fn registerStalePendingSweep():
  schedule("notifications.stale-pending-sweep", "0 */6 * * *", async () =>
    getNotificationsService().pruneStalePending()
  )
```

No other module subscribes → raw `schedule`/`registerJob` fine.

## See also

- [module-layout.md](module-layout.md) — where `events.ts` + `jobs/` sit
- [service-and-repo.md](service-and-repo.md) — sync counterpart
- [fallow-zones.md](fallow-zones.md) — why deep imports of `<module>/events` blocked

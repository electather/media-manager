# Events & jobs

The async API contract between modules. Sync via service (see [`service-and-repo.md`](service-and-repo.md)); fire-and-forget via events serialized as jobs.

## When to emit

> **Sync** when the caller needs the result to complete its work.
> **Async (event)** when the caller signals "this happened" and doesn't need an answer.

Heuristic: *if removing the call would leave the caller's return value unchanged but produce a missing side-effect, it should be an event.*

Examples:

- `catalog` added a new canonical media row → notify users, refresh search index, warm cache. **Event.**
- `home` composes a row that needs current catalog data. **Sync** (`catalog.getCanonical(...)`).
- `media` dispatch succeeded → record analytics, ping plugins. **Event** for analytics, sync for the dispatch itself.

## Declaring an event

```ts
// catalog/events.ts
import { z } from "zod";

export const CATALOG_EVENTS = {
  MEDIA_ADDED: "catalog.media.added",
  MEDIA_REMOVED: "catalog.media.removed",
} as const;

export const mediaAddedPayload = z.object({
  mediaId: z.string(),
  userId: z.string(),
  occurredAt: z.string().datetime(),
});
export type MediaAddedPayload = z.infer<typeof mediaAddedPayload>;

export const mediaRemovedPayload = z.object({
  mediaId: z.string(),
  removedBy: z.string(),
});
export type MediaRemovedPayload = z.infer<typeof mediaRemovedPayload>;
```

Rules:

- Event name format: `<module>.<entity>.<verb-past-tense>`. Lower-kebab segments.
- One `<MODULE>_EVENTS` const per module. Other modules reference the constant, never the string literal.
- Payloads are zod schemas. Derive the type with `z.infer`.
- `events.ts` is pure (no side effects, no runtime imports beyond `zod`).
- Adding a field → minor changeset. Changing a field type or required-ness → minor with a migration note. Removing a field → minor + check consumers.

## Emitting

```ts
// catalog/service.ts
import { emit } from "../jobs/events";                       // typed wrapper
import { CATALOG_EVENTS, mediaAddedPayload } from "./events";

async addMedia(input: AddMediaInput) {
  const row = await this.repo.insertCanonical(input);
  await emit(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, {
    mediaId: row.id,
    userId: input.userId,
    occurredAt: row.createdAt.toISOString(),
  });
  return row;
}
```

Rules:

- Use `emit(name, schema, payload)` from `jobs/events`. Don't call raw `enqueue` for cross-module signals.
- `emit` validates the payload via zod synchronously before enqueueing. Validation failure throws and the surrounding transaction rolls back (per repo's transactional pattern).
- If the surrounding repo write is itself transactional, `await emit(...)` after the transaction commits. Don't enqueue uncommitted state.

## Consuming

```ts
// notifications/jobs/on-catalog-media-added.ts
import { on } from "../../jobs/events";
import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog";   // barrel — never ../../catalog/events
import { getNotificationsService } from "..";

export function registerOnCatalogMediaAdded(): void {
  on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async (payload) => {
    await getNotificationsService().notifyMediaAdded(payload);
  });
}
```

```ts
// notifications/jobs/index.ts
import { registerOnCatalogMediaAdded } from "./on-catalog-media-added";
// ...other handler files

export function registerJobs(): void {
  registerOnCatalogMediaAdded();
  // ...
}
```

```ts
// notifications/index.ts (barrel)
export { registerJobs } from "./jobs";
```

Rules:

- Each handler file exports `register<X>(): void`. No top-level `on(...)` — registration happens only when `registerJobs()` is called.
- Handler file name matches the event: `on-<source>-<entity>-<verb>.ts`.
- Import event const + schema from the producer's **barrel**. Never deep-import `<producer>/events`.
- Handlers are idempotent. The runner retries on throw.

## Boot order

Two-stage boot. No top-level side effects.

1. **Stage A:** `apps/server/src/index.ts` and `apps/server/src/worker.ts` call `<module>.registerJobs()` for every module in fixed **alphabetical** order:
   ```ts
   import * as artwork from "./artwork";
   import * as auth from "./auth";
   import * as catalog from "./catalog";
   // ...
   artwork.registerJobs();
   auth.registerJobs();
   catalog.registerJobs();
   home.registerJobs();
   media.registerJobs();
   notifications.registerJobs();
   preferences.registerJobs();
   pluginRuntime.registerJobs();
   ```
2. **Stage B:** the job runner starts polling. Web routes accept requests.

`boot.test.ts` enforces:

- Alphabetical order (matters because fan-out is sequential).
- Every event declared in any `<module>/events.ts` has at least one `on(...)` registration after Stage A completes.

## Fan-out

Multiple modules can subscribe to the same event:

```ts
// notifications/jobs/on-catalog-media-added.ts
on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, notifyHandler);

// home/jobs/on-catalog-media-added.ts
on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, refreshLayoutHandler);
```

Both handlers run in **registration order** (sequential). If one throws, the dispatcher rethrows and the runner retries the whole event. Handlers must be idempotent.

For independent handlers where one failure shouldn't poison the rest, use a parallel variant (not yet shipped — TODO follow-up).

## Runtime cycles

Static import cycles (`A → B → A`) are forbidden (fallow `circular-deps: error` for `server-mod-*`).

Runtime event cycles (`A emits → B handles → B emits → A handles`) are allowed but require care:

- Document the cycle in a sequence diagram in the producer's `events.ts` header comment.
- Each leg must converge (the loop terminates because the state stabilises).
- Add a max-depth guard or a dedup key in the payload if the cycle could fire repeatedly on the same entity.

## What about scheduled work?

In-module scheduled jobs (no public contract) still use raw `enqueue` / `registerJob`. Example: a periodic sweep that prunes stale rows.

```ts
// notifications/jobs/stale-pending-sweep.ts
import { registerJob, schedule } from "../../jobs";

export function registerStalePendingSweep(): void {
  schedule("notifications.stale-pending-sweep", "0 */6 * * *", async () => {
    await getNotificationsService().pruneStalePending();
  });
}
```

This is fine because no other module subscribes to it.

## See also

- [`module-layout.md`](module-layout.md) — where `events.ts` and `jobs/` sit.
- [`service-and-repo.md`](service-and-repo.md) — sync contract counterpart.
- [`fallow-zones.md`](fallow-zones.md) — why deep imports of `<module>/events` are blocked.

# Example: add a cross-module event

Scenario: `catalog` adds media → `notifications` notify user + `home` invalidate row cache.

## 1. Producer declares (R12)

```ts
// catalog/events.ts
import { z } from "zod";

export const CATALOG_EVENTS = {
  MEDIA_ADDED: "catalog.media.added",         // <module>.<entity>.<verb-past>
} as const;

export const mediaAddedPayload = z.object({
  mediaId: z.string(),
  userId: z.string(),
  occurredAt: z.string().datetime(),
});
export type MediaAddedPayload = z.infer<typeof mediaAddedPayload>;
```

Barrel re-exports `events.ts` already → consumers can `import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog"`.

## 2. Producer emits

```ts
// catalog/service.ts
import { emit } from "../jobs/events";
import { CATALOG_EVENTS, mediaAddedPayload } from "./events";

async addMedia(input) {
  const row = await this.repo.insert(input);
  await emit(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, {
    mediaId: row.id,
    userId: input.userId,
    occurredAt: row.createdAt.toISOString(),
  });
  return row;
}
```

zod validation @ `emit` → throws sync → tx rollback if wrapped.

## 3. Consumer A: notifications

```ts
// notifications/jobs/on-catalog-media-added.ts
import { on } from "../../jobs/events";
import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog";    // BARREL — never ../../catalog/events
import { getNotificationsService } from "..";

export function registerOnCatalogMediaAdded(): void {
  on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async (p) => {
    await getNotificationsService().notifyMediaAdded(p);
  });
}
```

Register via `<module>/jobs/index.ts`:

```ts
// notifications/jobs/index.ts
import { registerOnCatalogMediaAdded } from "./on-catalog-media-added";
// ...
export function registerJobs(): void {
  registerOnCatalogMediaAdded();
  // ...
}
```

## 4. Consumer B: home (fan-out, R7)

```ts
// home/jobs/on-catalog-media-added.ts
import { on } from "../../jobs/events";
import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog";
import { getHomeService } from "..";

export function registerOnCatalogMediaAdded(): void {
  on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async (p) => {
    await getHomeService().invalidateRowsFor(p.userId);
  });
}
```

Both `on(...)` calls same event → wrapper fans out sequentially in registration order. First throw aborts rest → runner retries whole event. Handlers MUST be idempotent.

## 5. Boot wires it

```ts
// apps/server/src/index.ts + worker.ts
// alphabetical:
catalog.registerJobs();    // (no-op for emit-only side)
home.registerJobs();
notifications.registerJobs();
```

`boot.test.ts` checks: ≥1 `on(...)` registered per declared event.

## 6. Test the producer

```ts
// catalog/__tests__/service.test.ts
import { vi } from "vite-plus/test";
import * as jobsEvents from "../../jobs/events";

it("emits media.added", async () => {
  const emit = vi.spyOn(jobsEvents, "emit");
  await svc.addMedia({ /* ... */ });
  expect(emit).toHaveBeenCalledWith(
    "catalog.media.added",
    expect.anything(),
    expect.objectContaining({ mediaId: "..." }),
  );
});
```

## 7. Test the consumer

```ts
// notifications/__tests__/on-catalog-media-added.test.ts
it("notifies on payload", async () => {
  const svc = { notifyMediaAdded: vi.fn() };
  // call the handler directly, bypass on(...)
  await handlerFn({ mediaId: "x", userId: "u", occurredAt: "..." });
  expect(svc.notifyMediaAdded).toHaveBeenCalled();
});
```

## 8. Changeset (R5)

```md
---
"@ent-mcp/server": minor
---

catalog emits media.added; home + notifications react.
```

## 9. Changing an event later

- Add field → minor, optional or default value.
- Rename / require / type change → minor + check all consumers + update test fixtures.
- Remove field → minor + check all consumers.
- Rename event → soft-deprecate: emit both names for a release, migrate consumers, remove old.

## 10. Anti-patterns

```ts
// ❌ deep import producer events
import { CATALOG_EVENTS } from "../../catalog/events";

// ❌ string literal instead of constant (R12)
on("catalog.media.added", mediaAddedPayload, handler);

// ❌ top-level on() call (R7)
on(CATALOG_EVENTS.MEDIA_ADDED, ...);   // outside register<X>()

// ❌ raw registerJob for cross-mod event
import { registerJob } from "../../jobs";
registerJob("catalog.media.added", ...);   // bypass zod + fan-out

// ❌ sync call when event fits
await getNotificationsService().notify(...);   // in catalog.service.ts — creates coupling
```

## See

- [`events-and-jobs.md`](../events-and-jobs.md)
- [`service-and-repo.md`](../service-and-repo.md) — sync alternative

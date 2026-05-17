import type { z } from "zod";
import { registerTriggerable } from "./triggerable";
import type { EventName } from "./event-name";

type Handler = (raw: unknown) => Promise<void>;

/**
 * Per-event handler list. The first `on(name, ...)` registers a single
 * dispatcher with the underlying triggerable registry; subsequent
 * `on(name, ...)` calls append to the same list and rely on that dispatcher
 * to invoke them in registration order.
 */
const handlerLists = new Map<string, Handler[]>();

/**
 * Registers a single dispatcher for an event with the triggerable job
 * registry. The dispatcher iterates the handler list sequentially; a handler
 * throw rethrows to the runner so retry semantics apply to the whole event.
 *
 * Side effect on the public API surface: the event name doubles as a
 * triggerable job id. That means every event is admin-triggerable from the
 * admin jobs API under `requiredPermission: "admin:jobs"` — intentional
 * (manual replay + debugging) but worth knowing when picking event names.
 */
function registerJob(name: string, handler: Handler): void {
  registerTriggerable<unknown, void>({
    id: name,
    name,
    requiredPermission: "admin:jobs",
    handler: async (_ctx, input) => {
      // `null` here would mean the runner fired a cron-style tick with no
      // payload — `emit` always validates and passes a payload, so the only
      // way to reach this is a wiring bug (someone registered the dispatcher
      // outside the wrapper). Throw rather than swallow so it surfaces.
      if (input === null) {
        throw new Error(`event "${name}" dispatcher called with null input — emitter wiring bug`);
      }
      await handler(input);
    },
  });
}

/**
 * Subscribes a handler to an event. The handler receives the parsed payload;
 * dispatch-time zod validation propagates to the runner on failure. Multiple
 * `on(name, ...)` calls fan out — all handlers run sequentially in
 * registration order; first throw aborts the rest and the runner retries the
 * whole event.
 */
export function on<P>(
  name: EventName,
  schema: z.ZodType<P>,
  handler: (payload: P) => Promise<void>,
): void {
  const wrapped: Handler = async (raw) => {
    await handler(schema.parse(raw));
  };
  const existing = handlerLists.get(name as string);
  if (existing) {
    existing.push(wrapped);
    return;
  }
  const list: Handler[] = [wrapped];
  handlerLists.set(name as string, list);
  registerJob(name as string, async (raw) => {
    for (const h of list) {
      await h(raw);
    }
  });
}

/** Returns the list of event names currently registered. Used by `boot.test.ts`. */
export function registeredEventNames(): string[] {
  return Array.from(handlerLists.keys());
}

/**
 * Test-only reset of the in-memory handler list. Also call `stopAll()` from
 * `./index` to clear the underlying registry.
 */
export function __resetHandlerRegistryForTests(): void {
  handlerLists.clear();
}

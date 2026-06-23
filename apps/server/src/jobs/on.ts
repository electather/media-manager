import type { z } from "zod";
import { registerTriggerable } from "./triggerable";
import type { EventName } from "./event-name";

type Handler = (raw: unknown) => Promise<void>;

/**
 * Per-event handler list. First `on(name, ...)` registers a dispatcher with
 * triggerable registry; subsequent calls append to the list and rely on that
 * dispatcher to invoke handlers in registration order.
 */
const handlerLists = new Map<string, Handler[]>();

/**
 * Dispatcher rethrows handler errors to the runner so retry semantics apply
 * to the whole event. Side effect: event name is a triggerable job id, making
 * every event admin-triggerable under `requiredPermission: "admin:jobs"`
 * (intentional for manual replay + debugging).
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
 * Subscribes a handler to an event. Zod validation propagates to the runner
 * on failure. First throw aborts remaining handlers; runner retries the whole
 * event.
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

/**
 * Public surface of the typed event wrapper. Modules import `emit`, `on`, and
 * the `EventName` brand from this file (or via `../jobs/events`); never from
 * the sibling implementation files directly.
 *
 * The wrapper is split across three files so the runner's `import { emit }
 * from "./emit"` does not drag `./triggerable` into the import graph. The old
 * single-file shape created an `events → triggerable → runner → events` static
 * cycle that fallow's `circular-deps: error` rule flagged. The split keeps
 * `emit` free of any `triggerable` dependency while `on` retains it for
 * dispatcher registration.
 */
export type { EventName } from "./event-name";
export { emit } from "./emit";
export { on, registeredEventNames, __resetHandlerRegistryForTests } from "./on";

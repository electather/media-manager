/** Public surface; import `emit`, `on`, `EventName` from here, not implementation files.
 * Split across 3 files to avoid circular dependency (events → triggerable → runner → events).
 * Keeps `emit` free of `triggerable` while `on` retains it for dispatcher registration. */
export type { EventName } from "./event-name";
export { emit } from "./emit";
export { on, registeredEventNames, __resetHandlerRegistryForTests } from "./on";

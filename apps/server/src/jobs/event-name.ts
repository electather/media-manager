/**
 * Branded event-name string. Producers expose `<MODULE>_EVENTS` as-const objects
 * whose values are cast to `EventName`; consumers pass the constant — not the
 * literal — into `emit`/`on`. Lives in a leaf file so neither the emit nor on
 * implementation has to bring the other into the static graph.
 */
export type EventName = string & { readonly __brand: "EventName" };

/** Branded string type; producers cast `<MODULE>_EVENTS` as-const, consumers pass constant to `emit`/`on`. */
export type EventName = string & { readonly __brand: "EventName" };

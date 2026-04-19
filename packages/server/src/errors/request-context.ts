import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextValue {
  requestId: string;
  userId: string | null;
  route: string | null;
}

const storage = new AsyncLocalStorage<RequestContextValue>();

/** Runs `fn` inside a freshly-scoped request context. Subsequent captureError calls
 *  within this call tree will see the supplied requestId, userId, and route. */
export function runWithRequestContext<T>(
  value: RequestContextValue,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(value, fn);
}

/** Returns the current request context, or null when called outside one
 *  (e.g. during boot or outside a registered capture path). */
export function currentRequestContext(): RequestContextValue | null {
  return storage.getStore() ?? null;
}

/** Returns a fresh UUIDv4 used to correlate errors across surfaces. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

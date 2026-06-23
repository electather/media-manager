import type { CoalescedJobHandle } from "../../jobs/types";

/**
 * Module-local storage for `CoalescedJobHandle`. Registry deliberately omits `trigger()`
 * to prevent silent-drop bugs (Pre-Phase-3a). Leaf module breaks cycle with
 * `incremental-rebuild.ts` (which imports `getPreferencesService`).
 */
let handle: CoalescedJobHandle | undefined;

export function setIncrementalHandle(h: CoalescedJobHandle): void {
  handle = h;
}

/**
 * Best-effort trigger; silently no-ops if unregistered (daily rebuild safety net
 * catches it, and feedback row is already persisted).
 */
export function triggerIncremental(userId: string): void {
  handle?.trigger({ scopeKey: userId, userId });
}

/** Test seam: drop the captured handle so the next register call rewires. */
export function resetIncrementalHandleForTest(): void {
  handle = undefined;
}

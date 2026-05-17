import type { CoalescedJobHandle } from "../../jobs/types";

/**
 * Module-local storage for the `CoalescedJobHandle` returned by
 * `registerCoalesced` inside `incremental-rebuild.ts`. The handle's
 * `trigger` method is the only correct way to drive a coalesced job —
 * the registry entry stored under `jobs/registry.ts` deliberately does
 * not expose `trigger`, so calling `find(jobId).trigger` always
 * resolves to `undefined`. Pre-Phase-3a callers had this latent bug
 * (`ent_feedback` cast the registry entry and silently dropped every
 * incremental trigger).
 *
 * Kept as a leaf module so `service.ts` can call `triggerIncremental(userId)`
 * without import-cycling into `jobs/incremental-rebuild.ts`, which itself
 * imports `getPreferencesService` for the handler.
 */
let handle: CoalescedJobHandle | undefined;

export function setIncrementalHandle(h: CoalescedJobHandle): void {
  handle = h;
}

/**
 * Best-effort trigger. Silently no-ops when the job is not yet registered
 * (cold worker before `registerJobs()` settles); the caller has already
 * persisted the feedback row, and the daily rebuild safety net picks it up
 * if the live trigger never lands.
 */
export function triggerIncremental(userId: string): void {
  handle?.trigger({ scopeKey: userId, userId });
}

/** Test seam: drop the captured handle so the next register call rewires. */
export function resetIncrementalHandleForTest(): void {
  handle = undefined;
}

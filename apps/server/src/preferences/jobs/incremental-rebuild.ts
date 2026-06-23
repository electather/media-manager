import { registerCoalesced } from "../../jobs/coalesced";
import { getPreferencesService } from "../service";
import { PREFERENCE_INCREMENTAL_JOB_ID } from "./ids";
import { setIncrementalHandle } from "./incremental-handle";

export { PREFERENCE_INCREMENTAL_JOB_ID } from "./ids";

// Coalesced job debouncing ent_feedback bursts per userId so multi-rating flurries roll into
// one update instead of per-row passes. Daily rebuild is correction pass; incremental skips renormalization.
// CoalescedJobHandle.trigger() is captured for service.ts to read via triggerIncremental(userId).
export function registerIncrementalRebuild(): void {
  const handle = registerCoalesced({
    id: PREFERENCE_INCREMENTAL_JOB_ID,
    name: "Incremental preference update",
    description: "Debounced incremental update triggered by user feedback.",
    debounceMs: 30_000,
    maxWaitMs: 5 * 60_000,
    scopeKey: (input) => String((input as { userId?: string }).userId ?? ""),
    handler: async (_ctx, _triggerCount, scopeKey) => {
      if (!scopeKey) return;
      await getPreferencesService().applyIncrementalUpdate(scopeKey);
    },
    timeoutSec: 60,
  });
  setIncrementalHandle(handle);
}

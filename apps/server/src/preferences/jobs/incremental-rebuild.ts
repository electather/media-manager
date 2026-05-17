import { registerCoalesced } from "../../jobs/coalesced";
import { getPreferencesService } from "../service";

export const PREFERENCE_INCREMENTAL_JOB_ID = "host.preference.incremental_update";

/**
 * Coalesced incremental-update job. Debounces bursts of `ent_feedback`
 * writes by `userId` so a multi-rating flurry rolls into a single update
 * call instead of one engine pass per row. The daily safety-net rebuild
 * remains the correction pass — incremental skips renormalization.
 */
export function registerIncrementalRebuild(): void {
  registerCoalesced({
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
}

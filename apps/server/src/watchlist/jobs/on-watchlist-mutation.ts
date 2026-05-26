import { on } from "../../jobs/events";
import { invalidateMoodSummary } from "../moods/cluster";
import { invalidateCounts } from "../service";
import { invalidateTonightSection } from "../tonight/section";
import { WATCHLIST_EVENTS, watchlistItemAddedSchema, watchlistItemRemovedSchema } from "../events";

let registered = false;

/**
 * Subscribe Tonight, mood-summary, and counts cache invalidators to watchlist
 * mutation events. Idempotent (RISK-001 in the plan) so a test that calls
 * `registerJobs()` twice doesn't double-register handlers.
 */
export function register(): void {
  if (registered) return;
  registered = true;
  on(WATCHLIST_EVENTS.ITEM_ADDED, watchlistItemAddedSchema, async ({ userId }) => {
    await Promise.all([
      invalidateTonightSection(userId),
      invalidateMoodSummary(userId),
      invalidateCounts(userId),
    ]);
  });
  on(WATCHLIST_EVENTS.ITEM_REMOVED, watchlistItemRemovedSchema, async ({ userId }) => {
    await Promise.all([
      invalidateTonightSection(userId),
      invalidateMoodSummary(userId),
      invalidateCounts(userId),
    ]);
  });
}

/** Test-only. */
export function __resetRegistration(): void {
  registered = false;
}

import { on } from "../../jobs/events";
import { invalidate as invalidateMoods } from "../moods/cluster";
import { invalidate as invalidateTonight } from "../tonight/section";
import { WATCHLIST_EVENTS, watchlistItemAddedSchema, watchlistItemRemovedSchema } from "../events";

let registered = false;

/**
 * Subscribe Tonight + Mood-summary cache invalidators to watchlist mutation
 * events. Idempotent (RISK-001 in the plan) so a test that calls
 * `registerJobs()` twice doesn't double-register handlers.
 */
export function register(): void {
  if (registered) return;
  registered = true;
  on(WATCHLIST_EVENTS.ITEM_ADDED, watchlistItemAddedSchema, async ({ userId }) => {
    invalidateTonight(userId);
    invalidateMoods(userId);
  });
  on(WATCHLIST_EVENTS.ITEM_REMOVED, watchlistItemRemovedSchema, async ({ userId }) => {
    invalidateTonight(userId);
    invalidateMoods(userId);
  });
}

/** Test-only. */
export function __resetRegistration(): void {
  registered = false;
}

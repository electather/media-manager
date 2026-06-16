import { on } from "../../jobs/events";
import { WATCHLIST_EVENTS, watchlistItemAddedSchema } from "../../media";
import { invalidateMoodSummary } from "../moods/cluster";
import { invalidateTonightSection } from "../tonight/section";

/**
 * Invalidates the Tonight section and mood-summary cache whenever an item is
 * added to a user's watchlist.
 */
export function registerOnWatchlistItemAdded(): void {
  on(WATCHLIST_EVENTS.ITEM_ADDED, watchlistItemAddedSchema, async ({ userId }) => {
    await Promise.all([invalidateTonightSection(userId), invalidateMoodSummary(userId)]);
  });
}

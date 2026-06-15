import { on } from "../../jobs/events";
import { WATCHLIST_EVENTS, watchlistItemRemovedSchema } from "../../media";
import { invalidateMoodSummary } from "../moods/cluster";
import { invalidateTonightSection } from "../tonight/section";

/**
 * Invalidates the Tonight section and mood-summary cache whenever an item is
 * removed from a user's watchlist.
 */
export function registerOnWatchlistItemRemoved(): void {
  on(WATCHLIST_EVENTS.ITEM_REMOVED, watchlistItemRemovedSchema, async ({ userId }) => {
    await Promise.all([invalidateTonightSection(userId), invalidateMoodSummary(userId)]);
  });
}

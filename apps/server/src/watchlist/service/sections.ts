import type { WatchlistMoodSummary, WatchlistSectionResponse } from "@ent-mcp/shared/watchlist";
import { getSummary as getMoodSummaryImpl } from "../moods/cluster";
import { getSection as getTonightSectionImpl } from "../tonight/section";
import { asWatchlistContext, type MaybeRowContext } from "./context";

/**
 * Tonight section delegator. Implementation lives in `tonight/section.ts`
 * so cache state can co-locate with `invalidate(userId)` for the mutation
 * listener.
 */
export async function getTonightSection(ctx: MaybeRowContext): Promise<WatchlistSectionResponse> {
  return getTonightSectionImpl(asWatchlistContext(ctx));
}

/** Mood-cluster summary delegator. */
export async function getMoodSummary(ctx: MaybeRowContext): Promise<WatchlistMoodSummary> {
  const c = asWatchlistContext(ctx);
  return getMoodSummaryImpl({ userId: c.userId, catalog: c.catalog, log: c.log });
}

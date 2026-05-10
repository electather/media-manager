import { fromContinueWatchingEntry } from "../adapters";
import type { RowProvider } from "../types";

const PAGE_SIZE = 12;

/**
 * "Up next" entries — server-stitched `nextUp` episodes plus shows the user
 * has on the shelf with no resume position yet. Bounded: the row ships in
 * one page and never paginates.
 */
const provider: RowProvider = {
  rowId: "continueWatching-next",
  kind: "continueWatching",
  titleKey: "home_row_nextInYourShows_header",
  eyebrowKey: "home_row_nextInYourShows_eyebrow",
  async eligibility(ctx) {
    return ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user");
  },
  async initialCursor() {
    return null;
  },
  async fetchPage(ctx) {
    const res = await ctx.mediaService.getContinueWatchingFeed({ deadlineMs: ctx.deadlineMs });
    const eligible = res.items.filter((entry) => entry.nextUp != null || entry.progressMs == null);
    const items = eligible
      .map((entry) => fromContinueWatchingEntry(entry, { useNextUp: entry.nextUp != null }))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, PAGE_SIZE);
    return { items, cursor: null, partial: res.partial };
  },
};

export default provider;

import { fromContinueWatchingEntry } from "../internal/adapters";
import { makeBoundedRow } from "./_shared";
import { continueWatchingNextSource } from "../sources/continue-watching";

const PAGE_SIZE = 12;

/**
 * "Up next" entries — server-stitched `nextUp` episodes plus shows the user
 * has on the shelf with no resume position yet. The selection lives in
 * `continueWatchingNextSource.fetchRawSet`; this row keeps only the projection
 * and the bounded single-page slice (it never paginates).
 */
const provider = makeBoundedRow({
  rowId: "continueWatching-next",
  kind: "continueWatching",
  titleKey: "home_row_nextInYourShows_header",
  eyebrowKey: "home_row_nextInYourShows_eyebrow",
  capability: "continueWatching",
  source: continueWatchingNextSource,
  project: (_ctx, rows) =>
    rows
      .map((entry) => fromContinueWatchingEntry(entry, { useNextUp: entry.nextUp != null }))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, PAGE_SIZE),
});

export default provider;

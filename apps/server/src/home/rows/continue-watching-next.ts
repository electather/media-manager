import { fromContinueWatchingEntry } from "../internal/adapters";
import { makeBoundedRow } from "../internal/pipeline";
import { ROW_PAGE_SIZE } from "./_shared";
import { continueWatchingNextSource } from "../sources/continue-watching";

/**
 * "Up next" entries — server-stitched `nextUp` episodes plus shows the user
 * has on the shelf with no resume position yet. The selection lives in
 * `continueWatchingNextSource.fetchRawSet`; this row projects the entries and
 * bounds to a single page (so the shared pipeline mints `cursor: null` — it
 * never paginates).
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
      .slice(0, ROW_PAGE_SIZE),
});

export default provider;

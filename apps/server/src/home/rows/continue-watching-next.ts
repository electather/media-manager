import { fromContinueWatchingEntry } from "../internal/adapters";
import { makeBoundedRow } from "../internal/pipeline";
import { ROW_PAGE_SIZE } from "./_shared";
import { continueWatchingNextSource } from "../sources/continue-watching";

/** Projects "up next" entries and bounds to single page (selection in `continueWatchingNextSource`). */
const provider = makeBoundedRow({
  rowId: "continueWatching-next",
  kind: "continueWatching",
  titleKey: "home_row_nextInYourShows_header",
  eyebrowKey: "home_row_nextInYourShows_eyebrow",
  capability: "continueWatching",
  source: continueWatchingNextSource,
  project: (_ctx, rows) =>
    // Bound to one page before enrich to avoid per-item cost on full list;
    // pipeline's `paginate` trims after `enrichHomeItems`.
    rows
      .map((entry) => fromContinueWatchingEntry(entry, { useNextUp: entry.nextUp != null }))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, ROW_PAGE_SIZE),
});

export default provider;

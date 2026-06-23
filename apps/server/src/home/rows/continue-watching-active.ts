import { fromContinueWatchingEntry } from "../internal/adapters";
import { makePipelineRow } from "../internal/pipeline";
import { continueWatchingActiveSource } from "../sources/continue-watching";

/**
 * Active-resume entries: non-zero progress under "finishing soon" threshold.
 * Filter + ordering in `continueWatchingActiveSource.fetchRawSet`; projects to
 * `CompactMediaItem`. Pipeline owns offset slice + cursor.
 */
const provider = makePipelineRow({
  rowId: "continueWatching-active",
  kind: "continueWatching",
  titleKey: "home_row_continueWatching_header",
  cursorMode: continueWatchingActiveSource.stages.cursorMode,
  source: continueWatchingActiveSource,
  params: undefined,
  eligibility: (ctx) => ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user"),
  initialCursor: async () => null,
  project: (_ctx, rows) =>
    rows
      .map((entry) => fromContinueWatchingEntry(entry))
      .filter((item): item is NonNullable<typeof item> => item !== null),
});

export default provider;

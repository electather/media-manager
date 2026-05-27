import { fromContinueWatchingEntry } from "../internal/adapters";
import { makePipelineRow } from "../internal/pipeline";
import { continueWatchingActiveSource } from "../sources/continue-watching";

/**
 * Active-resume entries: any item with non-zero progress under the
 * "finishing soon" threshold. The filter + `lastPlayedAt` ordering live in
 * `continueWatchingActiveSource.fetchRawSet`; this row projects every selected
 * entry to a `CompactMediaItem` and the shared pipeline owns the offset slice +
 * cursor (`media.listRows`).
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

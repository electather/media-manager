import type { ContinueWatchingEntry } from "@ent-mcp/plugin-sdk";
import { orderBy } from "es-toolkit/array";
import { isActiveContinueWatchingEntry } from "../../media";
import type { MediaSource } from "../../media";

/**
 * Continue-watching feed source (design §H/§M.5). Both home continue-watching
 * rows read the same `continueWatching@v1` feed and differ only in the
 * content-defining selection over it, so one factory serves both — `select`
 * picks (and, for the active row, orders) the entries the way `feedKind`
 * differentiates the discover sources. `fetchRawSet` returns the selected
 * entries as raw rows and nothing else (invariant V.MC1); the per-row
 * slice/cursor/projection stays in the row until US-022 folds it into the
 * shared pipeline. A plugin soft-failure rides through as `partial: true`.
 */
function makeContinueWatchingSource(config: {
  sourceId: string;
  select: (entries: ContinueWatchingEntry[]) => ContinueWatchingEntry[];
}): MediaSource<void, ContinueWatchingEntry> {
  return {
    sourceId: config.sourceId,
    async fetchRawSet(ctx) {
      const res = await ctx.mediaService.getContinueWatchingFeed({ deadlineMs: ctx.deadlineMs });
      return { rows: config.select(res.items), partial: res.partial };
    },
    // `"none"`: `select` returns the entries in final row order (active sorts by
    // `lastPlayedAt`, next keeps feed order), so the pipeline must preserve it.
    // Offset: both rows page by index off the selected set.
    stages: { sort: "none", cursorMode: "offset" },
  };
}

/**
 * Active-resume entries: any item with non-zero progress under the "finishing
 * soon" threshold, sorted by `lastPlayedAt` descending so the most recently
 * watched title stays on top.
 */
export const continueWatchingActiveSource = makeContinueWatchingSource({
  sourceId: "continueWatching-active",
  select: (entries) =>
    orderBy(
      entries.filter(isActiveContinueWatchingEntry),
      [(entry) => entry.lastPlayedAt ?? ""],
      ["desc"],
    ),
});

/**
 * "Up next" entries — server-stitched `nextUp` episodes plus shows the user has
 * on the shelf with no resume position yet.
 */
export const continueWatchingNextSource = makeContinueWatchingSource({
  sourceId: "continueWatching-next",
  select: (entries) => entries.filter((entry) => entry.nextUp != null || entry.progressMs == null),
});

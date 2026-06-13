import type { ActiveRow } from "@nama/shared/media";
import {
  listActiveRowsKeyset,
  type Cursor,
  type MediaSource,
  type PipelineConfig,
  type SourceContext,
} from "../../media";

/** Request params for the watchlist `recently` source (`/sections/recently`). */
export interface RecentlyParams {
  limit: number;
}

/**
 * The watchlist `recently` `MediaSource` (design §S.4 / consolidation §H).
 * Recently-added is a bounded, no-cursor preview of the last `limit` rows by
 * `addedAt` DESC: the source fetches exactly `limit` keyset rows (the first
 * window, no resume position) and supplies them raw; the media pipeline
 * (`listRows`) enriches + sorts (`recentDesc`, a stable no-op over the already
 * `addedAt`-DESC window). It supplies ONLY the raw rows + a `stages` declaration
 * (V.MC1). The section envelope discards the page cursor (the preview is not
 * paginated), so the source never threads a `nextRaw` hop token.
 */
export const recentlySource: MediaSource<RecentlyParams> = {
  sourceId: "watchlist.recently",
  fetchRawSet: fetchRecentlyRawSet,
  stages: { sort: "recentDesc", cursorMode: "keyset" },
};

/** Pipeline config for a recently-added read: the first `limit` rows, no cursor. */
export function recentlyCfg(params: RecentlyParams): PipelineConfig<RecentlyParams> {
  return { params, cursor: null, limit: params.limit };
}

/**
 * Fetch the first keyset window (`limit` rows, `addedAt` DESC / `id` DESC). This
 * is a bounded preview, so it never threads a `nextRaw` hop token — the pipeline
 * mints `cursor:null` and the section envelope discards it. Matches the
 * pre-refactor `getRecentlyAdded` (`listActiveRowsKeyset(userId, {limit})`)
 * exactly.
 */
async function fetchRecentlyRawSet(
  ctx: SourceContext,
  params: RecentlyParams,
  _cursor: Cursor | null,
): Promise<{ rows: ActiveRow[]; partial: boolean }> {
  const rows = await listActiveRowsKeyset(ctx.userId, { limit: params.limit });
  return { rows, partial: false };
}

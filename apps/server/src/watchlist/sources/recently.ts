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
 * design §S.4 / consolidation §H: bounded no-cursor preview of last `limit` rows by `addedAt` DESC.
 * Fetches keyset rows (first window), supplies raw + stages (V.MC1); pipeline sorts as no-op.
 * Section envelope discards cursor (not paginated), no `nextRaw` hop token.
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
 * Fetch first keyset window (`limit` rows, `addedAt`/`id` DESC). Bounded preview: no `nextRaw` token.
 * Equivalent to pre-refactor `getRecentlyAdded(userId, {limit})`.
 */
async function fetchRecentlyRawSet(
  ctx: SourceContext,
  params: RecentlyParams,
  _cursor: Cursor | null,
): Promise<{ rows: ActiveRow[]; partial: boolean }> {
  const rows = await listActiveRowsKeyset(ctx.userId, { limit: params.limit });
  return { rows, partial: false };
}

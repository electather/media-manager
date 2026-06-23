import { selectTimelinePage, type LensFilters } from "../repo";
import type { LibraryRow } from "../types";
import { ensureSeeded } from "../service";
import type { Cursor, MediaSource, RawPageToken, SourceContext } from "../../media";
import { decodeTimeline, timelineToken } from "./keyset";

/**
 * Timeline lens source params: filter axes + page size. Cursor handled by keyset codec, not carried here (same pattern as {@link AzParams}).
 */
export interface TimelineParams {
  filters: LensFilters;
  limit: number;
}

/**
 * Timeline library lens (design §The 5 lenses), pages in `(year DESC, id)` order via pre-sorted SQL.
 * Uses `sort: "none"` and `cursorMode: "keyset"` to mint next cursor from year-keyed hop token.
 */
export const timelineSource: MediaSource<TimelineParams, LibraryRow> = {
  sourceId: "library-timeline",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one Timeline page from repo (R2, no drizzle), threads `(year, id)` keyset cursor and filters.
 * First-page read eagerly seeds unseeded user (design §Sync + hydrate: eager-seed).
 * `partial` always false (indexed read); `nextRaw` emitted only on full page.
 */
async function fetchRawSet(
  ctx: SourceContext,
  params: TimelineParams,
  cursor: Cursor | null,
): Promise<{ rows: LibraryRow[]; partial: boolean; nextRaw?: RawPageToken }> {
  if (!cursor) await ensureSeeded(ctx);
  const decoded = decodeTimeline(cursor);
  const page = await selectTimelinePage(ctx.userId, params.filters, decoded, params.limit);
  const nextRaw = page.nextRow ? timelineToken(page.nextRow) : undefined;
  return { rows: page.rows, partial: false, ...(nextRaw !== undefined ? { nextRaw } : {}) };
}

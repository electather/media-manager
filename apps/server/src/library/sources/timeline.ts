import { selectTimelinePage, type LensFilters } from "../repo";
import type { LibraryRow } from "../types";
import { ensureSeeded } from "../internal/reads";
import type { Cursor, MediaSource, RawPageToken, SourceContext } from "../../media";
import { decodeTimeline, timelineToken } from "./keyset";

/**
 * Source params for the Timeline lens: the filter axes plus the page size. Same
 * split as {@link AzParams} — the opaque cursor is handled by the keyset codec,
 * not carried here.
 */
export interface TimelineParams {
  filters: LensFilters;
  limit: number;
}

/**
 * The Timeline library lens `MediaSource` (design §The 5 lenses). Identical in
 * shape to the A–Z source but pages in `(year DESC, id)` order. The SQL
 * pre-sorts, so the pipeline runs `sort: "none"`; `cursorMode: "keyset"` lets
 * `paginate` mint the next cursor from the year-keyed hop token.
 */
export const timelineSource: MediaSource<TimelineParams, LibraryRow> = {
  sourceId: "library-timeline",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one Timeline page from the repo (no drizzle here — R2), threading the
 * decoded `(year, id)` keyset cursor and the requested filters. A first-page
 * read eagerly seeds a not-yet-seeded user inline (design §Sync + hydrate:
 * eager-seed). `partial` is always false (a pure indexed table read); `nextRaw`
 * is emitted only on a full page so the cursor ends on a short read.
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

import { selectAzPage, type LensFilters } from "../repo";
import type { LibraryRow } from "../types";
import { ensureSeeded } from "../internal/reads";
import type { Cursor, MediaSource, RawPageToken, SourceContext } from "../../media";
import { azToken, decodeAz } from "./keyset";

/**
 * Source params for the A–Z lens: the filter axes plus the page size. The opaque
 * cursor is decoded separately by the `paginate` stage / the keyset codec, so it
 * is not on this shape (mirrors the watchlist `ItemsParams` split).
 */
export interface AzParams {
  filters: LensFilters;
  limit: number;
}

/**
 * The A–Z library lens `MediaSource` (design §The 5 lenses). It produces ONLY a
 * raw, SQL-pre-sorted page of `library_items` rows; the shared media pipeline
 * (`listRows`) owns enrich (via the library `enrichRows` override) / sort /
 * paginate. Because the SQL already ordered by `(sort_title, id)`, the source
 * declares `sort: "none"` so the pipeline preserves that order, and
 * `cursorMode: "keyset"` so `paginate` mints the next cursor from `nextRaw`.
 */
export const azSource: MediaSource<AzParams, LibraryRow> = {
  sourceId: "library-az",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one A–Z page from the repo (no drizzle here — R2), threading the
 * decoded keyset cursor and the requested filters. A first-page read for a
 * not-yet-seeded user eagerly seeds membership inline so the page is not empty
 * on first paint (design §Sync + hydrate: eager-seed). `partial` is always
 * false: the page is a pure indexed table read with no plugin fan-out. The last
 * row becomes `nextRaw` only when the page was full (another page may follow);
 * a short page exhausts the scan and emits no token so `paginate` ends the
 * cursor.
 */
async function fetchRawSet(
  ctx: SourceContext,
  params: AzParams,
  cursor: Cursor | null,
): Promise<{ rows: LibraryRow[]; partial: boolean; nextRaw?: RawPageToken }> {
  if (!cursor) await ensureSeeded(ctx);
  const decoded = decodeAz(cursor);
  const page = await selectAzPage(ctx.userId, params.filters, decoded, params.limit);
  const nextRaw = page.nextRow ? azToken(page.nextRow) : undefined;
  return { rows: page.rows, partial: false, ...(nextRaw !== undefined ? { nextRaw } : {}) };
}

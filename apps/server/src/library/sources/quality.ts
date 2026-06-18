import { selectQualityPage, type LensFilters } from "../repo";
import type { ExpandedLibraryRow } from "../types";
import { ensureSeeded } from "../service";
import type { Cursor, MediaSource, RawPageToken, SourceContext } from "../../media";
import { decodeQuality, qualityToken } from "./keyset";

/**
 * Source params for the Quality lens: the filter axes plus the page size. Same
 * split as the flat lenses — the opaque cursor is decoded by the keyset codec,
 * not carried here.
 */
export interface QualityParams {
  filters: LensFilters;
  limit: number;
}

/**
 * The Quality library lens `MediaSource` (design §The 5 lenses). It pages the
 * owned set EXPANDED across `json_each(quality_tiers)`, so a title held in two
 * tiers appears once per tier section — the row set is intentionally not
 * distinct by title. Its row type is {@link ExpandedLibraryRow}: each row
 * carries the tier section (the tier label is both id and label) and the SQL
 * rank ordinal the page sorted by, which the keyset codec reuses verbatim so the
 * hop token never re-derives a rank that could disagree with the `ORDER BY`. The
 * SQL pre-sorts by `(tierRank, sortTitle, id)`, so the pipeline runs
 * `sort: "none"`; `cursorMode: "keyset"` mints the next cursor from the
 * rank-keyed hop token.
 */
export const qualitySource: MediaSource<QualityParams, ExpandedLibraryRow> = {
  sourceId: "library-quality",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one Quality page from the repo (no drizzle here — R2), threading the
 * decoded `(tierRank, sortTitle, id)` keyset cursor and the requested filters. A
 * first-page read eagerly seeds a not-yet-seeded user inline (design §Sync +
 * hydrate: eager-seed). `partial` is always false (a pure indexed table read).
 * `nextRaw` is built from the LAST RETURNED expanded row — never the dropped
 * overflow row — via {@link qualityToken}, and only on a full page so the cursor
 * ends on a short read.
 */
async function fetchRawSet(
  ctx: SourceContext,
  params: QualityParams,
  cursor: Cursor | null,
): Promise<{ rows: ExpandedLibraryRow[]; partial: boolean; nextRaw?: RawPageToken }> {
  if (!cursor) await ensureSeeded(ctx);
  const decoded = decodeQuality(cursor);
  const page = await selectQualityPage(ctx.userId, params.filters, decoded, params.limit);
  const nextRaw = page.nextRow ? qualityToken(page.nextRow) : undefined;
  return { rows: page.rows, partial: false, ...(nextRaw !== undefined ? { nextRaw } : {}) };
}

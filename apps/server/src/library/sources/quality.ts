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
 * Quality lens (design §The 5 lenses): EXPANDED pages across `json_each(quality_tiers)`
 * so titles in multiple tiers appear once per tier. {@link ExpandedLibraryRow}
 * carries tier section + rank; keyset codec reuses rank so cursor never mismatches.
 */
export const qualitySource: MediaSource<QualityParams, ExpandedLibraryRow> = {
  sourceId: "library-quality",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one Quality page threading keyset `(tierRank, sortTitle, id)` cursor and filters.
 * First page eagerly seeds (design §Sync + hydrate: eager-seed). `partial` always false.
 * `nextRaw` built from last-returned row (never overflow) via {@link qualityToken}, only on full page.
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

import { selectAzPage, type LensFilters } from "../repo";
import type { LibraryRow } from "../types";
import { ensureSeeded } from "../service";
import type { Cursor, MediaSource, RawPageToken, SourceContext } from "../../media";
import { azToken, decodeAz } from "./keyset";

/**
 * A–Z lens params: filters + page size. Opaque cursor is decoded separately by `paginate` stage,
 * mirrors watchlist `ItemsParams` split.
 */
export interface AzParams {
  filters: LensFilters;
  limit: number;
}

/**
 * A–Z `MediaSource` (design §The 5 lenses). Returns raw SQL-pre-sorted `library_items` rows.
 * Pipeline owns enrich/sort/paginate. Declares `sort: "none"` to preserve SQL order by `(sort_title, id)`.
 * Declares `cursorMode: "keyset"` so `paginate` uses `nextRaw` for cursor minting.
 */
export const azSource: MediaSource<AzParams, LibraryRow> = {
  sourceId: "library-az",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one A–Z page, threading keyset cursor and filters. First page for unseeded user
 * eagerly seeds inline (design §Sync + hydrate: eager-seed). Always `partial: false`.
 * `nextRaw` only when page full (indicating more pages); short page emits no token to end cursor.
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

import { selectServerPage, type LensFilters } from "../repo";
import type { ExpandedLibraryRow } from "../types";
import { ensureSeeded } from "../service";
import type { Cursor, MediaSource, RawPageToken, SourceContext } from "../../media";
import { decodeServer, serverToken } from "./keyset";

/**
 * Filter axes + page size. Opaque cursor is decoded by keyset codec, not carried here.
 */
export interface ServerParams {
  filters: LensFilters;
  limit: number;
}

/** Server library lens (design §The 5 lenses). Paged EXPANDED across json_each(servers) so titles repeat per server. Row type ExpandedLibraryRow carries server context for enrichRows override. SQL pre-sorts (server, sortTitle, id), so sort: "none", cursorMode: "keyset". */
export const serverSource: MediaSource<ServerParams, ExpandedLibraryRow> = {
  sourceId: "library-server",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/** Fetches one Server page with decoded (sectionId, sortTitle, id) cursor. First page eagerly seeds (design §Sync + hydrate: eager-seed). Partial always false. nextRaw from serverToken only on full page. */
async function fetchRawSet(
  ctx: SourceContext,
  params: ServerParams,
  cursor: Cursor | null,
): Promise<{ rows: ExpandedLibraryRow[]; partial: boolean; nextRaw?: RawPageToken }> {
  if (!cursor) await ensureSeeded(ctx);
  const decoded = decodeServer(cursor);
  const page = await selectServerPage(ctx.userId, params.filters, decoded, params.limit);
  const nextRaw = page.nextRow ? serverToken(page.nextRow) : undefined;
  return { rows: page.rows, partial: false, ...(nextRaw !== undefined ? { nextRaw } : {}) };
}

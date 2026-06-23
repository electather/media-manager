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

/**
 * The Server library lens `MediaSource` (design §The 5 lenses). It pages the
 * owned set EXPANDED across `json_each(servers)`, so a title on two servers
 * appears once per server section — the row set is intentionally not distinct by
 * title. Its row type is therefore {@link ExpandedLibraryRow}: each row carries
 * the server section it expanded into, which the library `enrichRows` override
 * surfaces onto the `CompactMediaItem`. The SQL pre-sorts by
 * `(server, sortTitle, id)`, so the pipeline runs `sort: "none"`;
 * `cursorMode: "keyset"` mints the next cursor from the section-keyed hop token.
 */
export const serverSource: MediaSource<ServerParams, ExpandedLibraryRow> = {
  sourceId: "library-server",
  fetchRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/**
 * Fetches one Server page, threading decoded `(sectionId, sortTitle, id)` cursor
 * and filters. First page eagerly seeds user (design §Sync + hydrate: eager-seed).
 * `partial` always false (pure indexed read). `nextRaw` built from LAST RETURNED
 * row via {@link serverToken}, only on full page (cursor ends on short read).
 */
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

import { ROW_ASPECT } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem, RowData } from "@/features/home/lib/types";
import { encodeSeedCursor } from "@/shared/media/cursor";

/**
 * Builds a `RowData` stub for the detail page's "More like this" strip. The
 * cursor seeds the current title's `tmdbId`/`mediaType` so the server fetches
 * items similar to THIS title rather than a generic recommendation feed.
 * Different titles produce distinct cursors, keeping React Query cache entries
 * separate across detail-page navigations.
 *
 * `encodeSeedCursor` is the SAME helper the server `similarTo` source mints its
 * seed cursor with (`@nama/shared/media`), so the client-built cursor decodes
 * as the keyset shape the resolver expects (`cursorOnNull: "400"`,
 * `requiresInitialCursor`). The pre-cutover `encodeCursor({tmdbId,mediaType,
 * offset})` shape decoded to `null` against the new resolver and 400'd the row.
 */
export function buildRelatedRow(item: HomeMediaItem): RowData {
  return {
    id: "similarTo",
    kind: "similarTo",
    initialCursor: encodeSeedCursor({ seedId: item.tmdbId, seedType: item.mediaType }),
    defaultAspect: ROW_ASPECT["similarTo"],
  };
}

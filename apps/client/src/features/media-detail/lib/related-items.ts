import { encodeCursor } from "@ent-mcp/shared/home";
import { ROW_ASPECT } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem, RowData } from "@/features/home/lib/types";

/**
 * Builds a `RowData` stub for the detail page's "More like this" strip. The
 * cursor encodes the current title's `tmdbId` and `mediaType` so the server
 * fetches items similar to THIS title rather than a generic recommendation
 * feed. Different titles produce distinct cursors, keeping React Query cache
 * entries separate across detail-page navigations.
 *
 * `encodeCursor` is imported from `@ent-mcp/shared/home` so the wire format
 * stays aligned with the server's `similarTo` row decoder.
 */
export function buildRelatedRow(item: HomeMediaItem): RowData {
  return {
    id: "similarTo",
    kind: "similarTo",
    initialCursor: encodeCursor({ tmdbId: item.tmdbId, mediaType: item.mediaType, offset: 0 }),
    defaultAspect: ROW_ASPECT["similarTo"],
  };
}

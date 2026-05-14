import { ROW_ASPECT } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem, RowData } from "@/features/home/lib/types";

/**
 * Encodes a seed payload into the base64url cursor format the server's
 * `similarTo` row provider expects. Mirrors `encodeCursor` in the server's
 * cursor module using the browser's `btoa`.
 */
function encodeSimilarCursor(tmdbId: string, mediaType: "movie" | "tv"): string {
  const json = JSON.stringify({ tmdbId, mediaType, offset: 0 });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/**
 * Builds a `RowData` stub for the detail page's "More like this" strip. The
 * cursor encodes the current title's `tmdbId` and `mediaType` so the server
 * fetches items similar to THIS title rather than a generic recommendation
 * feed. Different titles produce distinct cursors, keeping React Query cache
 * entries separate across detail-page navigations.
 */
export function buildRelatedRow(item: HomeMediaItem): RowData {
  return {
    id: "similarTo",
    kind: "similarTo",
    initialCursor: encodeSimilarCursor(item.tmdbId, item.mediaType),
    defaultAspect: ROW_ASPECT["similarTo"],
  };
}

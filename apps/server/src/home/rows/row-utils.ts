import { decodeCursor } from "../cursor";
import type { RawMediaItem } from "../compact";

export function compositeId(item: RawMediaItem): string | null {
  const tmdbId = item.ids?.tmdb_id ?? null;
  if (!tmdbId) return null;
  return `${item.type}:${tmdbId}`;
}

export function readPage(cursor: string | null, rowId: "trendingNow" | "newReleases"): number {
  if (!cursor) return 0;
  return decodeCursor(rowId, cursor).p;
}

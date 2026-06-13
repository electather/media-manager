import type { WatchedState } from "@nama/shared/library";
import type { CompactMediaItem } from "@nama/shared/media";
import type { LibraryFilters } from "./types";

/**
 * The multi-valued facet axes read off a single item. Filtering itself is now
 * server-side (SQL `WHERE` + `json_each`), so these no longer feed a client
 * filter pass — they remain for the facet display + the card chip badges that
 * still read a title's quality tiers, servers, and genres directly.
 */
export function qualitiesOf(item: CompactMediaItem): string[] {
  return item.tags ?? [];
}

export function serversOf(item: CompactMediaItem): string[] {
  return item.availability?.servers.map((server) => server.label) ?? [];
}

export function genresOf(item: CompactMediaItem): string[] {
  return item.genres ?? [];
}

/** Whether an item carries started-but-meaningful progress worth classifying. */
function hasProgress(
  progress: CompactMediaItem["progress"],
): progress is NonNullable<CompactMediaItem["progress"]> {
  return progress != null && progress.total > 0 && progress.watched > 0;
}

/**
 * Classify a title by how far through it the user is. The server now drives the
 * `watched` facet/filter axis, but this stays for the card's own watched badge,
 * which reads the item's progress directly rather than a server-supplied flag.
 */
export function watchedStateOf(item: CompactMediaItem): WatchedState {
  const progress = item.progress;
  if (!hasProgress(progress)) return "unwatched";
  return progress.watched >= progress.total ? "watched" : "partial";
}

/** Total number of selected options across every facet axis. */
export function countActiveFilters(filters: LibraryFilters): number {
  return (
    filters.kinds.length +
    filters.genres.length +
    filters.qualities.length +
    filters.servers.length +
    filters.watched.length
  );
}

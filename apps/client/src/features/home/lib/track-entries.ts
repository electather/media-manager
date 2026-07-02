import type { HomeMediaItem } from "./types";

const ERROR_SENTINEL = { __kind: "error-sentinel" as const };
type ErrorSentinel = typeof ERROR_SENTINEL;

/** A row track slot: either a real media item or the trailing pagination-error card. */
export type TrackEntry = HomeMediaItem | ErrorSentinel;

export function isErrorSentinel(entry: TrackEntry): entry is ErrorSentinel {
  return (entry as ErrorSentinel).__kind === "error-sentinel";
}

/**
 * Builds the virtualized track's item list. When a pagination retry is pending
 * (`appendError`), one error sentinel rides at the tail so the inline retry
 * card occupies the last card slot instead of a separate region — keeping the
 * row's height stable. Without it the items array is returned unchanged.
 */
export function buildTrackEntries(items: HomeMediaItem[], appendError: boolean): TrackEntry[] {
  return appendError ? [...items, ERROR_SENTINEL] : items;
}

import type { WatchedState } from "@nama/shared/library";
import type { ProgressEntry } from "../../media";

/**
 * Derives `watchedState` from resume position via `loadProgressMap` (entries only
 * for active, unfinished progress): 0 < watched < total → "partial", watched ≥
 * total → "watched", 0 → "unwatched", absent → null ("unknown"—cannot distinguish
 * finished from never-started). CW feed already drops finished; null as own bucket.
 */
export function deriveWatchedState(progress: ProgressEntry | undefined): WatchedState | null {
  if (!progress) return null;
  if (progress.total > 0 && progress.watched >= progress.total) return "watched";
  if (progress.watched > 0) return "partial";
  return "unwatched";
}

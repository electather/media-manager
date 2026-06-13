import type { WatchedState } from "@nama/shared/library";
import type { ProgressEntry } from "../../media";

/**
 * Derives a row's `watchedState` facet from its resume position. The signal is
 * the continue-watching feed projected by `loadProgressMap`, which keys a
 * `{ watched, total }` entry only for titles with *active, unfinished* progress:
 *   - an entry with progress strictly between 0 and `total` → `"partial"`,
 *   - an entry at or past `total` → `"watched"` (defensive; the CW projection
 *     already drops finished titles, so this rarely fires),
 *   - an entry at zero watched → `"unwatched"`.
 *
 * Returns `null` when no entry exists for the row. Absence from the CW feed
 * means the title is either fully watched or never started — the feed cannot
 * distinguish the two — so `null` ("unknown") is the honest projection rather
 * than guessing `"unwatched"` and mislabelling a finished title. The facet and
 * the `watched` filter axis treat `null` as its own bucket. Pure and
 * deterministic so it is unit-testable in isolation (Rule 9).
 */
export function deriveWatchedState(progress: ProgressEntry | undefined): WatchedState | null {
  if (!progress) return null;
  if (progress.total > 0 && progress.watched >= progress.total) return "watched";
  if (progress.watched > 0) return "partial";
  return "unwatched";
}
